// Menü performansı — ürün bazında satış adedi, ciro, maliyet, kâr, marj.
//
// MALİYET NEDEN REÇETEDEN HESAPLANIYOR (dondurulmuş harekete BAKMADAN değil,
// ondan TÜRETİLEN birim maliyetle):
//
// Reçete stok hareketi fatura başına TEK satır yazılıyor ve kaynak mamüller
// açıklamada birleştiriliyor ("Reçete: Americano, Latte"). Bir fişte iki farklı
// kahve varsa ikisinin de kullandığı süt tek satırda toplanır — o satırı ürünlere
// bölecek veri yok. Bu yüzden:
//   • bileşenin GERÇEKLEŞEN birim maliyeti dondurulmuş hareketlerden alınır
//     (aralıktaki ağırlıklı ortalama),
//   • ürün başına miktar ise reçeteden `expandRecipeLines` ile hesaplanır —
//     satışta stoğu düşen fonksiyonun ta kendisi.
// Toplam, karlılık raporundaki dondurulmuş toplamla aynı çıkar; sapma ancak
// aralık içinde reçete değiştiyse olur, o yüzden ikisi de yanıtta dönüyor
// (`totals.cost` hesaplanan, `totals.frozenRecipeCost` gerçekleşen).

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { loadRecipeContext, resolveComponentCosts } from "@/lib/stock/recipe"
import { expandRecipeLines } from "@/lib/stock/recipe-expand"
import { num, parseRange, reportScope, RECIPE_MARK } from "@/lib/restoran/reports"

export const dynamic = "force-dynamic"

type ItemRow = {
  product_id: string | null
  name: string
  unit: string | null
  category: string | null
  qty: unknown
  revenue: unknown
}

type CostRow = { product_id: string | null; qty: unknown; amount: unknown }

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    await ensureCompanyAccess(companyId)

    const { start, end } = parseRange(searchParams)

    // Ciro: kalem net'i (satır iskontosu düşülmüş), fatura altı iskonto varsa
    // faturanın gerçek netAmount'ına oranlanarak dağıtılır.
    const itemRows = await prisma.$queryRaw<ItemRow[]>`
      ${reportScope(companyId, start, end)}
      SELECT ii."productId"                       AS product_id,
             COALESCE(p.name, ii.description)     AS name,
             p.unit                               AS unit,
             p.category                           AS category,
             SUM(ii.quantity)                     AS qty,
             SUM((ii.quantity * ii."unitPrice" - COALESCE(ii."discountAmount", 0))
                 * CASE WHEN s.items_net > 0 THEN s."netAmount" / s.items_net ELSE 1 END) AS revenue
      FROM invoice_items ii
      JOIN scope s ON s.id = ii."invoiceId"
      LEFT JOIN products p ON p.id = ii."productId"
      GROUP BY ii."productId", COALESCE(p.name, ii.description), p.unit, p.category
    `

    // Bileşenlerin aralıktaki gerçekleşen (dondurulmuş) ağırlıklı birim maliyeti.
    const costRows = await prisma.$queryRaw<CostRow[]>`
      ${reportScope(companyId, start, end)}
      SELECT m."productId"                                     AS product_id,
             SUM(ABS(m.quantity))                              AS qty,
             SUM(ABS(m.quantity) * COALESCE(m."unitPrice", 0)) AS amount
      FROM stock_movements m
      JOIN ref r ON r.ref_id = m.reference
      WHERE m.description LIKE ${RECIPE_MARK}
      GROUP BY m."productId"
    `

    const realizedUnitCost = new Map<string, number>()
    let frozenRecipeCost = 0
    for (const row of costRows) {
      const qty = num(row.qty)
      const amount = num(row.amount)
      frozenRecipeCost += amount
      if (row.product_id && qty > 0) realizedUnitCost.set(row.product_id, amount / qty)
    }

    const { recipes, unitOf } = await loadRecipeContext(prisma, companyId)

    // Önce genişlet: hangi bileşenlerin maliyetine ihtiyaç olduğunu ancak
    // genişlettikten sonra biliyoruz (yarı mamüller hammaddeye kadar açılıyor).
    const expanded = new Map<string, { components: Array<{ productId: string; quantity: number }> }>()
    const needCost = new Set<string>()
    for (const row of itemRows) {
      const productId = row.product_id
      if (!productId) continue
      const quantity = num(row.qty)
      if (!recipes.has(productId)) {
        // Reçetesiz menü ürünü (şişe su): maliyeti kendi alış fiyatından.
        needCost.add(productId)
        continue
      }
      const { components } = expandRecipeLines({
        lines: [{ productId, quantity }],
        recipes,
        unitOf,
      })
      expanded.set(productId, { components })
      for (const c of components) if (!realizedUnitCost.has(c.productId)) needCost.add(c.productId)
    }

    // Aralıkta hiç hareketi olmayan bileşen/ürün için alış fiyatına düş
    // (sunucunun satış anında kullandığı öncelikle aynı: purchasePrice → son alış).
    const fallbackCost = await resolveComponentCosts(companyId, Array.from(needCost))
    const unitCostOf = (productId: string): number | null =>
      realizedUnitCost.get(productId) ?? fallbackCost.get(productId) ?? null

    const items = itemRows.map((row) => {
      const productId = row.product_id
      const quantity = num(row.qty)
      const revenue = num(row.revenue)

      let cost = 0
      let costBasis: "recipe" | "purchase" | "none" = "none"
      /** Alış fiyatı girilmemiş bileşenler — maliyet EKSİK hesaplanmış demektir. */
      const priceless: string[] = []

      if (productId && expanded.has(productId)) {
        costBasis = "recipe"
        for (const c of expanded.get(productId)!.components) {
          const unitCost = unitCostOf(c.productId)
          if (unitCost == null) {
            priceless.push(c.productId)
            continue
          }
          cost += c.quantity * unitCost
        }
      } else if (productId) {
        const unitCost = unitCostOf(productId)
        if (unitCost != null) {
          costBasis = "purchase"
          cost = quantity * unitCost
        } else {
          priceless.push(productId)
        }
      }

      return {
        productId,
        name: row.name,
        unit: row.unit,
        category: row.category,
        quantity,
        revenue,
        cost,
        profit: revenue - cost,
        margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
        costBasis,
        pricelessCount: priceless.length,
      }
    })

    items.sort((a, b) => b.revenue - a.revenue)

    const totals = items.reduce(
      (acc, i) => {
        acc.quantity += i.quantity
        acc.revenue += i.revenue
        acc.cost += i.cost
        return acc
      },
      { quantity: 0, revenue: 0, cost: 0 }
    )

    return NextResponse.json({
      range: { start: start.toISOString(), end: end.toISOString() },
      items,
      totals: {
        ...totals,
        profit: totals.revenue - totals.cost,
        margin: totals.revenue > 0 ? ((totals.revenue - totals.cost) / totals.revenue) * 100 : null,
        // Karlılık raporunun kullandığı gerçekleşen reçete maliyeti; hesaplanan
        // toplamla arasındaki fark aralıkta reçete değiştiğini gösterir.
        frozenRecipeCost,
      },
    })
  } catch (error: any) {
    if (String(error?.message).includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("[Restoran] Menü performansı raporu hatası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
