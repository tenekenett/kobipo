// Günlük karlılık raporu — bkz. docs/restoran/PLAN.md "Adım 6".
//
// Ciro KDV HARİÇ (netAmount): PLAN'ın doğrulama senaryosu da böyle — 3 Latte
// için ciro 255 ₺, maliyet 51 ₺, marj %80. KDV dahil tahsilat ayrı alanda döner.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { Prisma } from "@prisma/client"
import {
  docCostCte,
  localDay,
  num,
  parseRange,
  pricelessCte,
  reportScope,
} from "@/lib/restoran/reports"

export const dynamic = "force-dynamic"

type DayRow = {
  day: Date
  receipts: bigint | number
  revenue_net: unknown
  revenue_gross: unknown
  recipe_cost: unknown
  direct_cost: unknown
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    await ensureCompanyAccess(companyId)

    const { start, end } = parseRange(searchParams)

    const [rows, pricelessRows] = await Promise.all([
      prisma.$queryRaw<DayRow[]>`
      ${reportScope(companyId, start, end)}, ${docCostCte(companyId)}
      SELECT ${localDay(Prisma.sql`s.date`)}      AS day,
             COUNT(*)                              AS receipts,
             COALESCE(SUM(s."netAmount"), 0)       AS revenue_net,
             COALESCE(SUM(s."totalAmount"), 0)     AS revenue_gross,
             COALESCE(SUM(c.recipe_cost), 0)       AS recipe_cost,
             COALESCE(SUM(c.direct_cost), 0)       AS direct_cost
      FROM scope s
      LEFT JOIN cost c ON c.doc_id = s.id
      GROUP BY 1
      ORDER BY 1
    `,
      prisma.$queryRaw<Array<{ cnt: bigint | number }>>`
      ${reportScope(companyId, start, end)}, ${pricelessCte(companyId)}
    `,
    ])

    const days = rows.map((r) => {
      const revenue = num(r.revenue_net)
      const recipeCost = num(r.recipe_cost)
      const directCost = num(r.direct_cost)
      const cost = recipeCost + directCost
      return {
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        receipts: num(r.receipts),
        revenue,
        revenueGross: num(r.revenue_gross),
        recipeCost,
        directCost,
        cost,
        profit: revenue - cost,
        margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
      }
    })

    const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((a, d) => a + pick(d), 0)
    const revenue = sum((d) => d.revenue)
    const recipeCost = sum((d) => d.recipeCost)
    const directCost = sum((d) => d.directCost)
    const cost = recipeCost + directCost
    const receipts = sum((d) => d.receipts)

    return NextResponse.json({
      range: { start: start.toISOString(), end: end.toISOString() },
      totals: {
        revenue,
        revenueGross: sum((d) => d.revenueGross),
        receipts,
        // Ortalama fiş KDV DAHİL: kasiyerin gördüğü tutar budur.
        avgTicket: receipts > 0 ? sum((d) => d.revenueGross) / receipts : 0,
        recipeCost,
        directCost,
        cost,
        grossProfit: revenue - cost,
        margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
        // Maliyeti hiç bilinmeyen ürün sayısı — bunlar 0 maliyetle toplandı,
        // yani gerçek marj gösterilenden DÜŞÜK. Ekran uyarı gösterir.
        pricelessCount: num(pricelessRows[0]?.cnt),
      },
      days,
    })
  } catch (error: any) {
    if (String(error?.message).includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("[Restoran] Karlılık raporu hatası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
