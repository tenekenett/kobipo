// Günlük karlılık raporu — bkz. docs/restoran/PLAN.md "Adım 6".
//
// Ciro KDV HARİÇ (netAmount): PLAN'ın doğrulama senaryosu da böyle — 3 Latte
// için ciro 255 ₺, maliyet 51 ₺, marj %80. KDV dahil tahsilat ayrı alanda döner.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
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
    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const { start, end } = parseRange(searchParams)

    const [rows, pricelessRows, paymentRows, documentRows] = await Promise.all([
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
      // Cironun ödeme tipine göre kırılımı — BELGE BAZINDA.
      //
      // EKSEN BELGE TARİHİ — Gün Sonu raporundaki dağılımdan farkı budur ve
      // bilinçlidir: oradaki soru "bugün kasaya ne girdi" (tahsilat tarihi),
      // buradaki "bu ciro neyle ödendi". Tahsilat eksenini buraya koymak
      // parçaların hemen üstteki ciroyu tutmamasına yol açardı — dünkü
      // veresiyenin bugünkü tahsilatı bu dönemin cirosuna ait değildir.
      //
      // Yöntem TOPLAMLARI ayrı sorgulanmıyor, bu satırlardan türetiliyor: iki
      // ayrı sorgu olsaydı özet ile tıklayınca açılan detay birbirinden
      // ayrışabilirdi ve hangisinin doğru olduğu belli olmazdı.
      //
      // `scope` zaten CANCELLED/CONVERTED'ı eliyor, ayrıca durum filtresi gerekmez.
      prisma.$queryRaw<Array<{ invoice_id: string; method: string; amount: unknown }>>`
      ${reportScope(companyId, start, end)}
      SELECT p."invoiceId"     AS invoice_id,
             p."paymentMethod" AS method,
             SUM(p.amount)     AS amount
      FROM invoice_payments p
      WHERE p."companyId" = ${companyId}
        AND p."invoiceId" IN (SELECT id FROM scope)
      GROUP BY 1, 2
    `,
      // Dilime tıklayınca listelenecek belgeler. Gün Sonu raporu da aralığın
      // tüm fişlerini böyle döndürüyor — ikinci bir uç açmaya değmez.
      prisma.$queryRaw<
        Array<{
          id: string
          invoiceNo: string
          date: Date
          isReceipt: boolean
          totalAmount: unknown
          customer_name: string | null
        }>
      >`
      ${reportScope(companyId, start, end)}
      SELECT s.id, s."invoiceNo", s.date, s."isReceipt", s."totalAmount", c.name AS customer_name
      FROM scope s
      LEFT JOIN customers c ON c.id = s."customerId"
      ORDER BY s.date DESC
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
    const revenueGross = sum((d) => d.revenueGross)

    // Belge id → { yöntem: tutar }
    const byInvoice = new Map<string, Record<string, number>>()
    for (const r of paymentRows) {
      const entry = byInvoice.get(r.invoice_id) ?? {}
      entry[r.method] = (entry[r.method] ?? 0) + num(r.amount)
      byInvoice.set(r.invoice_id, entry)
    }

    const documents = documentRows.map((d) => {
      const methods = byInvoice.get(d.id) ?? {}
      const total = num(d.totalAmount)
      const paid = Object.values(methods).reduce((a, v) => a + v, 0)
      return {
        id: d.id,
        invoiceNo: d.invoiceNo,
        date: d.date instanceof Date ? d.date.toISOString() : String(d.date),
        // Fiş mi fatura mı — ekran DOĞRU detay sayfasına götürsün diye lazım:
        // fişi `/faturalar/.../onizleme`de açmak onu "satış faturası" gibi gösteriyordu.
        isReceipt: d.isReceipt,
        customerName: d.customer_name,
        total,
        paid,
        // Belge bazında da negatife düşmesin (fazla tahsilat / iade).
        unpaid: Math.max(0, total - paid),
        methods,
      }
    })

    // Yöntem toplamları BELGELERDEN türetiliyor — özet ve detay tek kaynaktan.
    const methodTotals = new Map<string, { count: number; amount: number }>()
    for (const doc of documents) {
      for (const [method, amount] of Object.entries(doc.methods)) {
        const acc = methodTotals.get(method) ?? { count: 0, amount: 0 }
        // "İşlem" = o yöntemin geçtiği BELGE sayısı (tahsilat satırı değil):
        // dilime tıklayınca listelenen satır sayısıyla aynı olsun.
        acc.count += 1
        acc.amount += amount
        methodTotals.set(method, acc)
      }
    }
    const payments = [...methodTotals.entries()]
      .map(([method, v]) => ({ method, count: v.count, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount)
    const paidTotal = payments.reduce((a, p) => a + p.amount, 0)
    // Kalan = veresiye / açık hesap / eksik yazılmış tahsilat. AYRI dilim olarak
    // veriliyor: yalnız ödeme tiplerini göstermek yüzdeleri %100'e tamamlamaz ve
    // ekranda "para nerede" sorusu cevapsız kalırdı. Negatife düşmesin — fazla
    // tahsilat (iade/avans) durumunda 0 gösterilir.
    const unpaid = Math.max(0, revenueGross - paidTotal)

    return NextResponse.json({
      range: { start: start.toISOString(), end: end.toISOString() },
      totals: {
        revenue,
        revenueGross,
        receipts,
        // Ortalama fiş KDV DAHİL: kasiyerin gördüğü tutar budur.
        avgTicket: receipts > 0 ? revenueGross / receipts : 0,
        paidTotal,
        unpaid,
        recipeCost,
        directCost,
        cost,
        grossProfit: revenue - cost,
        margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
        // Maliyeti hiç bilinmeyen ürün sayısı — bunlar 0 maliyetle toplandı,
        // yani gerçek marj gösterilenden DÜŞÜK. Ekran uyarı gösterir.
        pricelessCount: num(pricelessRows[0]?.cnt),
      },
      payments,
      documents,
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
