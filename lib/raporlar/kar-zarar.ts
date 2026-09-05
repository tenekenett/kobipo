/**
 * Kar/zarar hesabı.
 *
 * `app/api/raporlar/kar-zarar/route.ts`ten ayıklandı — dışa aktarma ucu da aynı
 * fonksiyonu çağırır, böylece ekrandaki net kâr ile PDF'teki net kâr aynı olur.
 * Bilanço da geçmiş dönem kârı için buradan okur.
 *
 * NE OLMADIĞI: bu bir TEK DÜZEN gelir tablosu değildir. "Alışlar" satırı
 * dönemde kesilen alış faturalarının matrahıdır — SATILAN malın maliyeti
 * değil. Stoğa giren mal da, kira/danışmanlık gibi hizmet alımı da aynı satıra
 * düşer; hangisinin o dönem tüketildiğini söyleyecek bir maliyet defteri yok.
 * Satır bu yüzden "Satılan Malın Maliyeti" DİYE ADLANDIRILMAZ: eski ad, stok
 * alan firmada kârı olmadığı kadar düşük gösterip yanlış vaat ediyordu.
 */

import { prisma } from "@/lib/db/prisma"
import { PURCHASE_RETURN_WHERE, SALES_RETURN_WHERE } from "@/lib/cari/invoice-direction"
import { NOT_TRANSFER_WHERE } from "@/lib/finans/nakit-hareket"
import { periodWhere, resolvePeriodBounds } from "./date-range"

export type ProfitLossResult = {
  period: { startDate: string; endDate: string }
  /**
   * `sales` BRÜT satıştır; `returns` satış iadeleri. Net ciro = sales − returns.
   * İade ayrı satır olarak duruyor çünkü netlenmiş tek rakam, "faturalarımın
   * toplamı neden burada daha düşük" sorusunu cevapsız bırakır.
   */
  revenue: { sales: number; returns: number; other: number; total: number }
  /** Dönemdeki alış faturaları; `total` alış iadeleri düşülmüş NET tutardır. */
  purchases: { invoices: number; returns: number; total: number }
  grossProfit: number
  /** Faturaya bağlı OLMAYAN gider işlemleri — virman bacakları hariç. */
  otherExpenses: number
  netProfit: number
}

export async function computeProfitLoss(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<ProfitLossResult> {
  const companyId = args.companyId
  const bounds = resolvePeriodBounds(args.startDate, args.endDate)
  const date = periodWhere(bounds)
  const postedInvoice = { status: { notIn: ["CANCELLED", "CONVERTED"] }, date }

  const [salesInvoices, purchaseInvoices, otherIncome, otherExpense, salesReturns, purchaseReturns] =
    await Promise.all([
    // Gelirler (Satış faturaları)
    prisma.invoice.aggregate({
      where: { companyId, type: "SALES", ...postedInvoice },
      _sum: { netAmount: true },
    }),
    // Alışlar (Alış faturaları)
    prisma.invoice.aggregate({
      where: { companyId, type: "PURCHASE", ...postedInvoice },
      _sum: { netAmount: true },
    }),
    // Diğer gelirler (Transaction INCOME). Faturaya bağlı tahsilat işlemleri
    // satış faturasıyla birlikte zaten gelir yazıldığından hariç tutulur
    // (çift sayımı önler) — yalnızca faturasız serbest gelirler.
    //
    // VİRMAN da hariç: hesaplar arası aktarımın hedef bacağı `type=INCOME`
    // yazılıyor, yani kasadan bankaya para taşımak ciro üretiyordu.
    prisma.transaction.aggregate({
      where: {
        companyId,
        type: "INCOME",
        date,
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_WHERE,
      },
      _sum: { amount: true },
    }),
    // Diğer giderler (Transaction EXPENSE) — faturaya bağlı ödemeler hariç.
    prisma.transaction.aggregate({
      where: {
        companyId,
        type: "EXPENSE",
        date,
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_WHERE,
      },
      _sum: { amount: true },
    }),
    // İADELER: satış iadesi CİRODAN, alış iadesi ALIŞTAN düşer. Sayılmazsa
    // geri gelen mal satılmış gibi durur ve kâr olduğundan yüksek görünür.
    prisma.invoice.aggregate({
      where: { companyId, ...SALES_RETURN_WHERE(), ...postedInvoice },
      _sum: { netAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { companyId, ...PURCHASE_RETURN_WHERE(), ...postedInvoice },
      _sum: { netAmount: true },
    }),
  ])

  const revenue = {
    sales: Number(salesInvoices._sum.netAmount || 0),
    returns: Number(salesReturns._sum.netAmount || 0),
    other: Number(otherIncome._sum.amount || 0),
    total: 0,
  }
  revenue.total = revenue.sales - revenue.returns + revenue.other

  const purchases = {
    invoices: Number(purchaseInvoices._sum.netAmount || 0),
    returns: Number(purchaseReturns._sum.netAmount || 0),
    total: 0,
  }
  purchases.total = purchases.invoices - purchases.returns

  const grossProfit = revenue.total - purchases.total
  const otherExpenses = Number(otherExpense._sum.amount || 0)

  return {
    // Dönem sonu EKRANDA kapsayıcı gösterilir (sınır dışlayıcıdır).
    period: {
      startDate: bounds.start.toISOString(),
      endDate: new Date(bounds.endExclusive.getTime() - 1).toISOString(),
    },
    revenue,
    purchases,
    grossProfit,
    otherExpenses,
    netProfit: grossProfit - otherExpenses,
  }
}
