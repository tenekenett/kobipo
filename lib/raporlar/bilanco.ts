/**
 * Bilanço hesabı.
 *
 * `app/api/raporlar/bilanco/route.ts`ten ayıklandı — dışa aktarma ucu da aynı
 * fonksiyonu çağırır, ekrandaki aktif/pasif toplamıyla PDF'teki aynı olur.
 */

import { prisma } from "@/lib/db/prisma"

export type BalanceSheetResult = {
  asOfDate: string
  assets: { cashAndBanks: number; receivables: number; inventory: number; total: number }
  liabilities: { payables: number; total: number }
  equity: number
  total: number
  totalLiabilitiesAndEquity: number
}

export async function computeBalanceSheet(args: {
  companyId: string
  asOfDate?: string | null
}): Promise<BalanceSheetResult> {
  const companyId = args.companyId
  const date = args.asOfDate ? new Date(args.asOfDate) : new Date()

  const [cashAndBanks, receivables, paidAmount, inventory, payables, paidToSuppliers, profitLoss] =
    await Promise.all([
      // Aktifler (Varlıklar) — Nakit ve banka hesapları
      prisma.financialAccount.aggregate({
        where: { companyId, isActive: true },
        _sum: { balance: true },
      }),
      // Alacaklar (Müşteri bakiyeleri - ödenmemiş faturalar)
      prisma.invoice.aggregate({
        where: {
          companyId,
          type: "SALES",
          status: { notIn: ["CANCELLED", "CONVERTED"] },
          date: { lte: date },
        },
        _sum: { totalAmount: true },
      }),
      // Ödenen tutarları çıkar
      prisma.invoicePayment.aggregate({
        where: {
          companyId,
          invoice: { type: "SALES", date: { lte: date } },
          paymentDate: { lte: date },
        },
        _sum: { amount: true },
      }),
      // Stok değeri
      prisma.product.findMany({
        where: { companyId, isActive: true },
        select: { stockQuantity: true, purchasePrice: true, salePrice: true },
      }),
      // Pasifler — Borçlar (Tedarikçi bakiyeleri - ödenmemiş faturalar)
      prisma.invoice.aggregate({
        where: {
          companyId,
          type: "PURCHASE",
          status: { notIn: ["CANCELLED", "CONVERTED"] },
          date: { lte: date },
        },
        _sum: { totalAmount: true },
      }),
      prisma.invoicePayment.aggregate({
        where: {
          companyId,
          invoice: { type: "PURCHASE", date: { lte: date } },
          paymentDate: { lte: date },
        },
        _sum: { amount: true },
      }),
      // Öz sermaye — dönem kar/zararı
      prisma.accountingEntry.aggregate({
        where: { companyId, date: { lte: date } },
        _sum: { amount: true },
      }),
    ])

  const netReceivables =
    Number(receivables._sum.totalAmount || 0) - Number(paidAmount._sum.amount || 0)

  // Satın alma fiyatı yoksa satış fiyatına düş, yine yoksa 0 kabul et.
  const inventoryValue = inventory.reduce((sum, item) => {
    const quantity = Number(item.stockQuantity || 0)
    const unitCost = Number(item.purchasePrice ?? item.salePrice ?? 0)
    return sum + quantity * unitCost
  }, 0)

  const netPayables =
    Number(payables._sum.totalAmount || 0) - Number(paidToSuppliers._sum.amount || 0)

  // Başlangıç sermayesi (şimdilik 0, daha sonra Company modeline eklenebilir)
  const initialCapital = 0
  const equity = initialCapital + Number(profitLoss._sum.amount || 0)

  const assets = {
    cashAndBanks: Number(cashAndBanks._sum.balance || 0),
    receivables: netReceivables > 0 ? netReceivables : 0,
    inventory: inventoryValue,
    total:
      Number(cashAndBanks._sum.balance || 0) +
      (netReceivables > 0 ? netReceivables : 0) +
      inventoryValue,
  }

  const liabilities = {
    payables: netPayables > 0 ? netPayables : 0,
    total: netPayables > 0 ? netPayables : 0,
  }

  return {
    asOfDate: date.toISOString(),
    assets,
    liabilities,
    equity,
    total: assets.total,
    totalLiabilitiesAndEquity: liabilities.total + equity,
  }
}
