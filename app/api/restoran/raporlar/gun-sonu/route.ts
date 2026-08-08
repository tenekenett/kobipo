// Gün sonu — günün fişleri, ödeme tipi dağılımı, kasa sayımı karşılaştırması.
//
// İki farklı tarih ekseni bilinçli olarak ayrı tutuluyor:
//  • Fişler ve karlılık → BELGE tarihi (o gün ne satıldı)
//  • Ödeme dağılımı     → TAHSİLAT tarihi (o gün kasaya ne girdi)
// Dünkü veresiyenin bugün ödenmesi kasaya bugün girer; ikisini aynı eksende
// göstermek gün sonu sayımını yanlış çıkarırdı.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { docCostCte, loadOpenTickets, num, parseRange, reportScope } from "@/lib/restoran/reports"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type ReceiptRow = {
  id: string
  invoiceNo: string
  date: Date
  isReceipt: boolean
  netAmount: unknown
  totalAmount: unknown
  customer_name: string | null
  paid: unknown
  methods: string | null
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

    const [receiptRows, paymentRows, cashCounts, openTickets] = await Promise.all([
      prisma.$queryRaw<ReceiptRow[]>`
        ${reportScope(companyId, start, end)}, ${docCostCte(companyId)},
        pay AS (
          SELECT p."invoiceId",
                 SUM(p.amount)                              AS paid,
                 string_agg(DISTINCT p."paymentMethod", ',') AS methods
          FROM invoice_payments p
          WHERE p."companyId" = ${companyId}
            AND p."invoiceId" IN (SELECT id FROM scope)
          GROUP BY p."invoiceId"
        )
        SELECT s.id,
               s."invoiceNo",
               s.date,
               s."isReceipt",
               s."netAmount",
               s."totalAmount",
               c.name                          AS customer_name,
               COALESCE(pay.paid, 0)           AS paid,
               pay.methods                     AS methods,
               COALESCE(cost.recipe_cost, 0)   AS recipe_cost,
               COALESCE(cost.direct_cost, 0)   AS direct_cost
        FROM scope s
        LEFT JOIN customers c ON c.id = s."customerId"
        LEFT JOIN cost ON cost.doc_id = s.id
        LEFT JOIN pay ON pay."invoiceId" = s.id
        ORDER BY s.date
      `,
      // Tahsilat tarihine göre — o gün kasaya/bankaya fiilen GİREN para.
      //
      // `type = 'SALES'` şart: InvoicePayment alış faturalarında da kullanılıyor
      // (faturalar/odemeler/route.ts satışta +tutar, alışta -tutar yazar). Filtre
      // olmadan tedarikçiye yapılan ödeme "kasaya giren" sayılıyor ve gün sonu
      // sayım karşılaştırmasını bozuyordu.
      //
      // Durum dışlaması reportScope ile AYNI: CONVERTED de düşer, aksi halde
      // faturaya dönüşmüş fişin ödemesi hem fişte hem faturada sayılabilirdi.
      prisma.$queryRaw<Array<{ method: string; cnt: bigint | number; amount: unknown }>>`
        SELECT p."paymentMethod" AS method,
               COUNT(*)          AS cnt,
               SUM(p.amount)     AS amount
        FROM invoice_payments p
        JOIN invoices i ON i.id = p."invoiceId"
        WHERE p."companyId" = ${companyId}
          AND p."paymentDate" >= ${start}
          AND p."paymentDate" <= ${end}
          AND i.type = 'SALES'
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        GROUP BY p."paymentMethod"
        ORDER BY amount DESC
      `,
      prisma.cashCount.findMany({
        where: { companyId, countDate: { gte: start, lte: end } },
        include: { account: { select: { name: true } } },
        orderBy: { countDate: "asc" },
      }),
      // Gün KAPANIRKEN hâlâ açık olan masalar (Faz D). Bunlar fişe dönüşmediği
      // için yukarıdaki ciroda YOK ve stokları da düşmemiştir — gün sonu sayımı
      // yapan kişi bu tutarı bilmezse kasada eksik para arar.
      loadOpenTickets(prisma, companyId, end),
    ])

    const receipts = receiptRows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoiceNo,
      date: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      isReceipt: r.isReceipt,
      customerName: r.customer_name,
      net: num(r.netAmount),
      total: num(r.totalAmount),
      paid: num(r.paid),
      methods: r.methods ? r.methods.split(",").filter(Boolean) : [],
      cost: num(r.recipe_cost) + num(r.direct_cost),
    }))

    const revenue = receipts.reduce((a, r) => a + r.net, 0)
    const revenueGross = receipts.reduce((a, r) => a + r.total, 0)
    const cost = receipts.reduce((a, r) => a + r.cost, 0)
    const paidTotal = receipts.reduce((a, r) => a + r.paid, 0)

    const payments = paymentRows.map((p) => ({
      method: p.method,
      count: num(p.cnt),
      amount: num(p.amount),
    }))
    const cashReceived = payments
      .filter((p) => p.method === "CASH")
      .reduce((a, p) => a + p.amount, 0)

    return NextResponse.json({
      range: { start: start.toISOString(), end: end.toISOString() },
      summary: {
        receipts: receipts.length,
        revenue,
        revenueGross,
        avgTicket: receipts.length > 0 ? revenueGross / receipts.length : 0,
        cost,
        grossProfit: revenue - cost,
        margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
        // Belge toplamı ile tahsil edileni ayrı ver: farkı veresiye/açık hesaptır.
        paid: paidTotal,
        unpaid: revenueGross - paidTotal,
        cashReceived,
        // Açık masalar ciroya DAHİL DEĞİL; ayrı alan olarak veriliyor ki ekran
        // "henüz kesinleşmemiş" diye gösterebilsin.
        openTicketCount: openTickets.length,
        openTicketTotal: openTickets.reduce((a, t) => a + t.total, 0),
      },
      receipts,
      payments,
      openTickets,
      cashCounts: cashCounts.map((c) => ({
        id: c.id,
        accountName: c.account?.name ?? "",
        countDate: c.countDate.toISOString(),
        expected: Number(c.expectedBalance),
        actual: Number(c.actualBalance),
        difference: Number(c.difference),
        isApproved: c.isApproved,
        notes: c.notes,
      })),
    })
  } catch (error: any) {
    if (String(error?.message).includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("[Restoran] Gün sonu raporu hatası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
