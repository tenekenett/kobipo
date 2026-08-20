import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule, PLAN_ITEM_KINDS, planItemDefaults } from "@/lib/restoran/tickets"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

// Dükkan krokisi öğeleri (duvar, bar, kapı, mutfak…). Masalarla aynı ızgarayı
// paylaşırlar ama adisyon akışına GİRMEZLER — bkz. docs/restoran/ASAMA2.md.

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const items = await prisma.restaurantPlanItem.findMany({
      where: { companyId },
      orderBy: [{ y: "asc" }, { x: "asc" }],
    })

    return NextResponse.json(items)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching plan items:", error)
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

    const kind = String(body.kind || "")
    if (!PLAN_ITEM_KINDS.includes(kind as (typeof PLAN_ITEM_KINDS)[number])) {
      return NextResponse.json({ error: "Geçersiz öğe türü" }, { status: 400 })
    }

    const areaId = body.areaId ? String(body.areaId) : null
    if (areaId) {
      const area = await prisma.restaurantArea.findFirst({ where: { id: areaId, companyId } })
      if (!area) return NextResponse.json({ error: "Bölge bulunamadı" }, { status: 404 })
    }

    const preset = planItemDefaults(kind)

    // Koordinat verilmediyse aynı bölgedeki öğe sayısına göre boş bir yere koy;
    // yeni öğe daima görünür olsun, kullanıcı sonra sürükleyerek yerleştirsin.
    let x = Number.isFinite(Number(body.x)) ? Math.max(0, Math.trunc(Number(body.x))) : null
    let y = Number.isFinite(Number(body.y)) ? Math.max(0, Math.trunc(Number(body.y))) : null
    if (x == null || y == null) {
      const count = await prisma.restaurantPlanItem.count({ where: { companyId, areaId } })
      x = 0
      y = count % 12
    }

    const item = await prisma.restaurantPlanItem.create({
      data: {
        companyId,
        areaId,
        kind,
        label: body.label ? String(body.label).trim() : null,
        x,
        y,
        width: clampSize(body.width, preset.width),
        height: clampSize(body.height, preset.height),
      },
    })

    return NextResponse.json(item, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error creating plan item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** Ölçüler 1–40 hücre: duvar uzun olabilir ama sınırsız da olmamalı. */
function clampSize(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(40, Math.max(1, Math.trunc(n)))
}
