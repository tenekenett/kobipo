/**
 * Kar/zarar hesabı.
 *
 * `app/api/raporlar/kar-zarar/route.ts`ten ayıklandı — dışa aktarma ucu da aynı
 * fonksiyonu çağırır, böylece ekrandaki net kâr ile PDF'teki net kâr aynı olur.
 */

import { prisma } from "@/lib/db/prisma"
import { PURCHASE_RETURN_WHERE, SALES_RETURN_WHERE } from "@/lib/cari/invoice-direction"

export type ProfitLossResult = {
  period: { startDate: string; endDate: string }
  /**
   * `sales` BRÜT satıştır; `returns` satış iadeleri. Net ciro = sales − returns.
   * İade ayrı satır olarak duruyor çünkü netlenmiş tek rakam, "faturalarımın
   * toplamı neden burada daha düşük" sorusunu cevapsız bırakır.
   */
  revenue: { sales: number; returns: number; other: number; total: number }
  /** Alış iadeleri — maliyetten düşülen tutar (costOfGoodsSold zaten NET). */
  purchaseReturns: number
  costOfGoodsSold: number
  grossProfit: number
  operatingExpenses: number
  netProfit: number
}

export async function computeProfitLoss(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<ProfitLossResult> {
  const start = args.startDate ? new Date(args.startDate) : new Date(new Date().getFullYear(), 0, 1)
  const end = args.endDate ? new Date(args.endDate) : new Date()
  const companyId = args.companyId

  const [salesInvoices, purchaseInvoices, otherIncome, otherExpense, salesReturns, purchaseReturns] =
    await Promise.all([
    // Gelirler (Satış faturaları)
    prisma.invoice.aggregate({
      where: {
        companyId,
        type: "SALES",
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        date: { gte: start, lte: end },
      },
      _sum: { netAmount: true, vatAmount: true, totalAmount: true },
    }),
    // Giderler (Alış faturaları)
    prisma.invoice.aggregate({
      where: {
        companyId,
        type: "PURCHASE",
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        date: { gte: start, lte: end },
      },
      _sum: { netAmount: true, vatAmount: true, totalAmount: true },
    }),
    // Diğer gelirler (Transaction INCOME). Faturaya bağlı tahsilat işlemleri
    // satış faturasıyla birlikte zaten gelir yazıldığından hariç tutulur
    // (çift sayımı önler) — yalnızca faturasız serbest gelirler.
    prisma.transaction.aggregate({
      where: { companyId, type: "INCOME", date: { gte: start, lte: end }, invoicePayments: { none: {} } },
      _sum: { amount: true },
    }),
    // Diğer giderler (Transaction EXPENSE) — faturaya bağlı ödemeler hariç.
    prisma.transaction.aggregate({
      where: { companyId, type: "EXPENSE", date: { gte: start, lte: end }, invoicePayments: { none: {} } },
      _sum: { amount: true },
    }),
    // İADELER: satış iadesi CİRODAN, alış iadesi MALİYETTEN düşer. Sayılmazsa
    // geri gelen mal satılmış gibi durur ve kâr olduğundan yüksek görünür.
    prisma.invoice.aggregate({
      where: {
        companyId,
        ...SALES_RETURN_WHERE(),
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        date: { gte: start, lte: end },
      },
      _sum: { netAmount: true, vatAmount: true, totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        ...PURCHASE_RETURN_WHERE(),
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        date: { gte: start, lte: end },
      },
      _sum: { netAmount: true, vatAmount: true, totalAmount: true },
    }),
  ])

  const revenue =
    Number(salesInvoices._sum.netAmount || 0) -
    Number(salesReturns._sum.netAmount || 0) +
    Number(otherIncome._sum.amount || 0)
  const costOfGoodsSold =
    Number(purchaseInvoices._sum.netAmount || 0) - Number(purchaseReturns._sum.netAmount || 0)
  const grossProfit = revenue - costOfGoodsSold
  const operatingExpenses = Number(otherExpense._sum.amount || 0)
  const netProfit = grossProfit - operatingExpenses

  return {
    period: { startDate: start.toISOString(), endDate: end.toISOString() },
    revenue: {
      sales: Number(salesInvoices._sum.netAmount || 0),
      returns: Number(salesReturns._sum.netAmount || 0),
      other: Number(otherIncome._sum.amount || 0),
      total: revenue,
    },
    purchaseReturns: Number(purchaseReturns._sum.netAmount || 0),
    costOfGoodsSold,
    grossProfit,
    operatingExpenses,
    netProfit,
  }
}
