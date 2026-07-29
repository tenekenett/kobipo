import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Kroki öğesini taşır/boyutlandırır/yeniden adlandırır. Sürükle-bırak da buradan. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantPlanItem.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Öğe bulunamadı" }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.label !== undefined) {
      const label = String(body.label || "").trim()
      data.label = label || null
    }
    if (body.x !== undefined && Number.isFinite(Number(body.x))) {
      data.x = Math.max(0, Math.trunc(Number(body.x)))
    }
    if (body.y !== undefined && Number.isFinite(Number(body.y))) {
      data.y = Math.max(0, Math.trunc(Number(body.y)))
    }
    if (body.width !== undefined) data.width = clampSize(body.width, existing.width)
    if (body.height !== undefined) data.height = clampSize(body.height, existing.height)
    if (body.areaId !== undefined) {
      const areaId = body.areaId ? String(body.areaId) : null
      if (areaId) {
        const area = await prisma.restaurantArea.findFirst({ where: { id: areaId, companyId } })
        if (!area) return NextResponse.json({ error: "Bölge bulunamadı" }, { status: 404 })
      }
      data.areaId = areaId
    }

    const item = await prisma.restaurantPlanItem.update({ where: { id }, data })
    return NextResponse.json(item)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error updating plan item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantPlanItem.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Öğe bulunamadı" }, { status: 404 })

    // Krokinin geçmişi yok (masanın aksine adisyonu/cirosu yok) — gerçekten silinir.
    await prisma.restaurantPlanItem.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error deleting plan item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

function clampSize(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(40, Math.max(1, Math.trunc(n)))
}
