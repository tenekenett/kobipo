// Tek kontrol listesi maddesi — düzenle / sırala / kaldır.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { CHECKLIST_TITLE_MAX } from "@/lib/restoran/checklist"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    // companyId koşulu şart: id tek başına başka firmanın maddesini gösterebilir.
    const existing = await prisma.checklistItem.findFirst({
      where: { id, companyId },
      select: { id: true, type: true },
    })
    if (!existing) return NextResponse.json({ error: "Madde bulunamadı" }, { status: 404 })

    const data: { title?: string; sortOrder?: number; isActive?: boolean } = {}

    if (body.title !== undefined) {
      const title = String(body.title || "").trim().slice(0, CHECKLIST_TITLE_MAX)
      if (!title) return NextResponse.json({ error: "Madde metni zorunlu" }, { status: 400 })
      data.title = title
    }
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
      data.sortOrder = Number(body.sortOrder)
    }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)

    const item = await prisma.checklistItem.update({
      where: { id },
      data,
      select: { id: true, type: true, title: true, sortOrder: true, isActive: true },
    })

    // Metin değişse bile GEÇMİŞ onaylar dokunulmadan kalır: `itemTitle` kopyası
    // o günün listesinde neyin onaylandığını söyler, bugünkü metin değil.
    return NextResponse.json(item)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error updating checklist item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Maddeyi kaldır. Onay GÖRMÜŞ madde silinmez, PASİFLEŞTİRİLİR: silinseydi geçmiş
 * tikler maddesiz kalır ("1 Ağustos'ta liste tam mıydı" cevapsız kalırdı). Hiç
 * onay almamış madde — yeni eklenip yanlış yazılmış olan — gerçekten silinir,
 * yoksa liste düzenleme ekranı ilk günden çöp pasif maddeyle dolar.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.checklistItem.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { entries: true } } },
    })
    if (!existing) return NextResponse.json({ error: "Madde bulunamadı" }, { status: 404 })

    if (existing._count.entries > 0) {
      await prisma.checklistItem.update({ where: { id }, data: { isActive: false } })
      return NextResponse.json({ success: true, deactivated: true })
    }

    await prisma.checklistItem.delete({ where: { id } })
    return NextResponse.json({ success: true, deactivated: false })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error deleting checklist item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
