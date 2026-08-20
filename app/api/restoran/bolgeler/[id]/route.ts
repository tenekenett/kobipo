import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { PLAN_COLS_MIN, normalizeCols, requiredCols } from "@/lib/restoran/floor-plan"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantArea.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Bölge bulunamadı" }, { status: 404 })

    const data: { name?: string; order?: number; gridSize?: number; isActive?: boolean } = {}
    if (body.name !== undefined) {
      const name = String(body.name || "").trim()
      if (!name) return NextResponse.json({ error: "Bölge adı zorunlu" }, { status: 400 })
      const clash = await prisma.restaurantArea.findFirst({
        where: { companyId, name, id: { not: id } },
      })
      if (clash) return NextResponse.json({ error: "Bu adda bir bölge zaten var" }, { status: 409 })
      data.name = name
    }
    if (body.order !== undefined && Number.isFinite(Number(body.order))) data.order = Number(body.order)
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)

    // `gridSize` krokinin SÜTUN sayısıdır (satır oranla türetilir, saklanmaz).
    // Plan daraltılırken içerik dışarıda kalmamalı. Kırpmak (masayı zorla içeri
    // çekmek) sessizce yerleşimi bozardı; bunun yerine reddedip ne kadar
    // daraltılabileceğini söylüyoruz.
    if (body.gridSize !== undefined) {
      const wanted = normalizeCols(body.gridSize, existing.gridSize)
      const [tables, planItems] = await Promise.all([
        prisma.restaurantTable.findMany({
          where: { companyId, areaId: id },
          select: { x: true, y: true, width: true, height: true },
        }),
        prisma.restaurantPlanItem.findMany({
          where: { companyId, areaId: id },
          select: { x: true, y: true, width: true, height: true },
        }),
      ])
      const needed = requiredCols([...tables, ...planItems], PLAN_COLS_MIN)
      if (wanted < needed) {
        return NextResponse.json(
          { error: `Plan en fazla ${needed} sütuna kadar daraltılabilir; önce sağ kenardaki öğeleri içeri alın` },
          { status: 409 },
        )
      }
      data.gridSize = wanted
    }

    const area = await prisma.restaurantArea.update({
      where: { id },
      data,
      select: { id: true, name: true, order: true, gridSize: true, isActive: true },
    })

    return NextResponse.json(area)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error updating restaurant area:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * Bölgeyi siler. Masalar SİLİNMEZ — şemadaki `onDelete: SetNull` sayesinde
 * bölgesiz kalırlar (planda "Bölgesiz" sekmesinde görünürler). Masayı da silmek,
 * bir sekmeyi kapatırken masanın geçmiş adisyonlarını sahipsiz bırakırdı.
 */
export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantArea.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Bölge bulunamadı" }, { status: 404 })

    await prisma.restaurantArea.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error deleting restaurant area:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
