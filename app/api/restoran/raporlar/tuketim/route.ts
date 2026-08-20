// Hammadde tüketim raporu — aralıkta hangi bileşenden ne kadar gitti.
// Kaynak: reçeteden türeyen stok hareketleri (bkz. lib/restoran/reports.ts).

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { num, parseRange, reportScope, RECIPE_MARK } from "@/lib/restoran/reports"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Row = {
  product_id: string | null
  name: string | null
  unit: string | null
  stock_quantity: unknown
  min_stock_level: unknown
  qty: unknown
  amount: unknown
}

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const { start, end } = parseRange(searchParams)

    const rows = await prisma.$queryRaw<Row[]>`
      ${reportScope(companyId, start, end)}
      SELECT m."productId"                                        AS product_id,
             p.name                                               AS name,
             p.unit                                               AS unit,
             p."stockQuantity"                                    AS stock_quantity,
             p."minStockLevel"                                    AS min_stock_level,
             SUM(ABS(m.quantity))                                 AS qty,
             SUM(ABS(m.quantity) * COALESCE(m."unitPrice", 0))    AS amount
      FROM stock_movements m
      JOIN ref r ON r.ref_id = m.reference
      LEFT JOIN products p ON p.id = m."productId"
      WHERE m.description LIKE ${RECIPE_MARK}
      GROUP BY m."productId", p.name, p.unit, p."stockQuantity", p."minStockLevel"
      ORDER BY amount DESC
    `

    // Aralıktaki gün sayısı — "günlük ortalama" ve "kaç günlük stok kaldı" için.
    const dayMs = 24 * 60 * 60 * 1000
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / dayMs))

    const items = rows.map((r) => {
      const quantity = num(r.qty)
      const cost = num(r.amount)
      const stock = num(r.stock_quantity)
      const avgPerDay = quantity / days
      return {
        productId: r.product_id,
        name: r.name ?? "(silinmiş ürün)",
        unit: r.unit ?? "",
        quantity,
        cost,
        // Dondurulmuş hareketlerden çıkan gerçekleşen ortalama birim maliyet.
        unitCost: quantity > 0 ? cost / quantity : 0,
        stock,
        minStock: r.min_stock_level != null ? num(r.min_stock_level) : null,
        avgPerDay,
        // Bu hızla gidilirse eldeki stok kaç gün yeter. Tüketim yoksa anlamsız → null.
        daysLeft: avgPerDay > 0 ? stock / avgPerDay : null,
      }
    })

    const totalCost = items.reduce((a, i) => a + i.cost, 0)

    return NextResponse.json({
      range: { start: start.toISOString(), end: end.toISOString(), days },
      items: items.map((i) => ({
        ...i,
        share: totalCost > 0 ? (i.cost / totalCost) * 100 : 0,
      })),
      totals: { cost: totalCost, count: items.length },
    })
  } catch (error: any) {
    if (String(error?.message).includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("[Restoran] Tüketim raporu hatası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
