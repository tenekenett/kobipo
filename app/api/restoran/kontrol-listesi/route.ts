// Kontrol listesi MADDELERİ — patronun yazdığı liste.
//
// Tür başına tek liste var (OPENING / CLOSING), o yüzden ayrı şablon ucu yok:
// madde doğrudan firmaya bağlı. Günün onayları `kontrol-listesi/gun` ucunda.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { CHECKLIST_TITLE_MAX, isChecklistType } from "@/lib/restoran/checklist"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

const ITEM_SELECT = {
  id: true,
  type: true,
  title: true,
  sortOrder: true,
  isActive: true,
} as const

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const type = searchParams.get("type")
    if (type && !isChecklistType(type)) {
      return NextResponse.json({ error: "type OPENING veya CLOSING olmalı" }, { status: 400 })
    }

    // `all=1` yalnız düzenleme ekranında: pasif maddeler orada görünür ve geri
    // açılabilir, operasyon ekranlarının günlük listesinde çıkmaz.
    const items = await prisma.checklistItem.findMany({
      where: {
        companyId,
        ...(type ? { type } : {}),
        ...(searchParams.get("all") === "1" ? {} : { isActive: true }),
      },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: ITEM_SELECT,
    })

    return NextResponse.json(items)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching checklist items:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    if (!isChecklistType(body.type)) {
      return NextResponse.json({ error: "type OPENING veya CLOSING olmalı" }, { status: 400 })
    }

    const title = String(body.title || "").trim().slice(0, CHECKLIST_TITLE_MAX)
    if (!title) return NextResponse.json({ error: "Madde metni zorunlu" }, { status: 400 })

    // Aynı metin iki kez eklenmesin: tik günde madde BAŞINA tutulduğu için
    // birebir aynı iki madde listede ayırt edilemez, personel hangisini
    // işaretlediğini bilemez.
    const duplicate = await prisma.checklistItem.findFirst({
      where: { companyId, type: body.type, title, isActive: true },
      select: { id: true },
    })
    if (duplicate) {
      return NextResponse.json({ error: "Bu madde listede zaten var" }, { status: 409 })
    }

    const last = await prisma.checklistItem.findFirst({
      where: { companyId, type: body.type },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })

    const item = await prisma.checklistItem.create({
      data: {
        companyId,
        type: body.type,
        title,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdBy: user.id,
      },
      select: ITEM_SELECT,
    })

    return NextResponse.json(item, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error creating checklist item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
