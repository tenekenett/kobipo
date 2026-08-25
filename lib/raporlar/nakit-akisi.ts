/**
 * Nakit akış tablosu hesabı.
 *
 * `app/api/raporlar/nakit-akisi/route.ts`ten ayıklandı — dışa aktarma ucu da
 * aynı fonksiyonu çağırır.
 */

import { prisma } from "@/lib/db/prisma"
import { PURCHASE_RETURN_WHERE, SALES_RETURN_WHERE } from "@/lib/cari/invoice-direction"

export type CashFlowResult = {
  period: { startDate: string; endDate: string }
  beginningBalance: number
  operatingActivities: {
    collections: number
    payments: number
    otherIncome: number
    otherExpense: number
    net: number
  }
  investingActivities: { net: number }
  financingActivities: { net: number }
  netCashFlow: number
  endingBalance: number
}

export async function computeCashFlow(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<CashFlowResult> {
  const companyId = args.companyId
  const start = args.startDate ? new Date(args.startDate) : new Date(new Date().getFullYear(), 0, 1)
  const end = args.endDate ? new Date(args.endDate) : new Date()

  const [
    startBalance,
    collections,
    payments,
    otherIncome,
    otherExpense,
    endBalance,
    salesReturnRefunds,
    purchaseReturnRefunds,
  ] = await Promise.all([
      // Başlangıç bakiyesi
      prisma.financialAccount.aggregate({
        where: { companyId, isActive: true, createdAt: { lt: start } },
        _sum: { balance: true },
      }),
      // İşletme faaliyetlerinden nakit akışı.
      // NOT (çift sayım önleme): Bir tahsilat/ödeme faturaya eşleştirildiğinde hem
      // bir Transaction hem de transactionId dolu bir InvoicePayment oluşur. Aynı
      // nakit hareketini iki kez saymamak için InvoicePayment'lerden yalnızca
      // transactionId IS NULL olanlar (Transaction üretmeyen doğrudan ödemeler)
      // alınır; işleme bağlı tahsilat/ödemeler aşağıdaki Transaction toplamlarında
      // (otherIncome/otherExpense) zaten yer alır.
      // - Müşterilerden doğrudan tahsilatlar
      prisma.invoicePayment.aggregate({
        where: {
          companyId,
          transactionId: null,
          paymentDate: { gte: start, lte: end },
          invoice: { type: "SALES" },
        },
        _sum: { amount: true },
      }),
      // - Tedarikçilere doğrudan ödemeler
      prisma.invoicePayment.aggregate({
        where: {
          companyId,
          transactionId: null,
          paymentDate: { gte: start, lte: end },
          invoice: { type: "PURCHASE" },
        },
        _sum: { amount: true },
      }),
      // - Gelir işlemleri (faturaya bağlı tahsilatlar dahil tüm INCOME hareketleri)
      prisma.transaction.aggregate({
        where: { companyId, type: "INCOME", date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      // - Gider işlemleri (faturaya bağlı ödemeler dahil tüm EXPENSE hareketleri)
      prisma.transaction.aggregate({
        where: { companyId, type: "EXPENSE", date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      // Bitiş bakiyesi
      prisma.financialAccount.aggregate({
        where: { companyId, isActive: true },
        _sum: { balance: true },
      }),
      // İADE GERİ ÖDEMELERİ (yine yalnız transactionId IS NULL — işleme bağlı
      // olanlar aşağıdaki Transaction toplamlarında zaten var).
      //  - Müşteriye yapılan iade ödemesi kasadan ÇIKAR → tahsilattan düşülür.
      //  - Tedarikçiden alınan iade bedeli kasaya GİRER → ödemelerden düşülür.
      prisma.invoicePayment.aggregate({
        where: {
          companyId,
          transactionId: null,
          paymentDate: { gte: start, lte: end },
          invoice: SALES_RETURN_WHERE(),
        },
        _sum: { amount: true },
      }),
      prisma.invoicePayment.aggregate({
        where: {
          companyId,
          transactionId: null,
          paymentDate: { gte: start, lte: end },
          invoice: PURCHASE_RETURN_WHERE(),
        },
        _sum: { amount: true },
      }),
    ])

  // Net nakit: iade geri ödemeleri kendi yönlerinden düşülür.
  const netCollections =
    Number(collections._sum.amount || 0) - Number(salesReturnRefunds._sum.amount || 0)
  const netPayments =
    Number(payments._sum.amount || 0) - Number(purchaseReturnRefunds._sum.amount || 0)

  const operatingCashFlow =
    netCollections +
    Number(otherIncome._sum.amount || 0) -
    netPayments -
    Number(otherExpense._sum.amount || 0)

  // Yatırım ve finansman faaliyetleri şimdilik 0 (ayrı sınıflandırma yok).
  const investingCashFlow = 0
  const financingCashFlow = 0
  const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow

  return {
    period: { startDate: start.toISOString(), endDate: end.toISOString() },
    beginningBalance: Number(startBalance._sum.balance || 0),
    operatingActivities: {
      collections: netCollections,
      payments: netPayments,
      otherIncome: Number(otherIncome._sum.amount || 0),
      otherExpense: Number(otherExpense._sum.amount || 0),
      net: operatingCashFlow,
    },
    investingActivities: { net: investingCashFlow },
    financingActivities: { net: financingCashFlow },
    netCashFlow,
    endingBalance: Number(endBalance._sum.balance || 0),
  }
}
