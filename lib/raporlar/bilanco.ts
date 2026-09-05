/**
 * Bilanço hesabı.
 *
 * `app/api/raporlar/bilanco/route.ts`ten ayıklandı — dışa aktarma ucu da aynı
 * fonksiyonu çağırır, ekrandaki aktif/pasif toplamıyla PDF'teki aynı olur.
 *
 * ÖZ SERMAYE YEVMİYEDEN OKUNMAZ. Eskiden `accountingEntry._sum.amount` idi:
 * her fişin bir borç + bir alacak hesabı ve TEK `amount`'ı olduğu için o toplam
 * öz sermayeyi değil fiş hacmini veriyordu. Üstelik hesap planı hiçbir yerde
 * otomatik açılmıyor (`accountPlan.create` yalnız `/api/muhasebe/hesap-plani`ta)
 * ve otomatik fiş yalnız satış faturasında yazılıyor — çoğu firmada o toplam ya
 * 0'dı ya da satışların yarısıydı, dolayısıyla aktif ile pasif hiç tutmuyordu
 * (dışa aktarmadaki "Denge → Fark" satırı bunu itiraf ediyordu).
 *
 * Yerine öz sermaye TANIMINDAN kurulur: net varlık = aktif − yükümlülük. Bu
 * kimliği tuttururken açıklamayı da bırakır: kümülatif kâr ayrı satırda, kârla
 * açıklanamayan kısım (kuruluş sermayesi, ortak cari, kayıt dışı devir) "Sermaye
 * ve diğer düzeltmeler" satırında görünür kalır.
 */

import { prisma } from "@/lib/db/prisma"
import { PURCHASE_RETURN_WHERE, SALES_RETURN_WHERE } from "@/lib/cari/invoice-direction"
import { cashBalanceBefore } from "@/lib/finans/nakit-hareket"
import { composeBalanceSheet, type BalanceSheetSummary } from "./bilanco-ozet"
import { resolvePeriodBounds } from "./date-range"
import { computeProfitLoss } from "./kar-zarar"

/**
 * Aritmetik ve alan tanımları `bilanco-ozet.ts`te (saf, testli); burası yalnız
 * veriyi toplayıp oraya veriyor.
 */
export type BalanceSheetResult = BalanceSheetSummary & { asOfDate: string }

/**
 * Kümülatif kâr için dönem başlangıcı. Firmanın ilk kaydından öncesine düşen
 * herhangi bir gün yeterli; sabit tutuluyor ki rapor her çağrıda aynı kümülatifi
 * versin.
 */
const EPOCH = "1970-01-01"

export async function computeBalanceSheet(args: {
  companyId: string
  asOfDate?: string | null
}): Promise<BalanceSheetResult> {
  const companyId = args.companyId
  // Tarih GÜN SONUNU kapsar: `lte: new Date("2026-09-05")` gece yarısını
  // gösterip o günün bütün belgelerini bilançodan düşürüyordu.
  const bounds = resolvePeriodBounds(EPOCH, args.asOfDate ?? null)
  const until = { lt: bounds.endExclusive }
  const posted = { status: { notIn: ["CANCELLED", "CONVERTED"] }, date: until }

  const [
    cashAndBanks,
    profitLoss,
    receivableInvoices,
    receivablePayments,
    inventory,
    payableInvoices,
    payablePayments,
    salesReturns,
    salesReturnRefunds,
    purchaseReturns,
    purchaseReturnRefunds,
  ] = await Promise.all([
    // Nakit ve banka — TARİHE GÖRE. Eskiden hesapların bugünkü bakiyesiydi:
    // geçmiş bir güne bakan bilanço bugünkü parayı gösteriyordu.
    cashBalanceBefore(companyId, bounds.endExclusive),

    // Geçmiş dönem + cari dönem kârı, kümülatif.
    computeProfitLoss({ companyId, startDate: EPOCH, endDate: args.asOfDate ?? null }),

    // Alacaklar (müşteri bakiyeleri — ödenmemiş faturalar)
    prisma.invoice.aggregate({
      where: { companyId, type: "SALES", ...posted },
      _sum: { totalAmount: true },
    }),
    prisma.invoicePayment.aggregate({
      where: { companyId, invoice: { type: "SALES", date: until }, paymentDate: until },
      _sum: { amount: true },
    }),

    // Stok değeri
    prisma.product.findMany({
      where: { companyId, isActive: true },
      select: { stockQuantity: true, purchasePrice: true },
    }),

    // Borçlar (tedarikçi bakiyeleri — ödenmemiş faturalar)
    prisma.invoice.aggregate({
      where: { companyId, type: "PURCHASE", ...posted },
      _sum: { totalAmount: true },
    }),
    prisma.invoicePayment.aggregate({
      where: { companyId, invoice: { type: "PURCHASE", date: until }, paymentDate: until },
      _sum: { amount: true },
    }),

    // İADELER: satış iadesi ALACAĞI, alış iadesi BORCU azaltır. Geri ödemeleri
    // de düşülür — iade geri ödendiyse alacak o kadar azalmış sayılmaz.
    prisma.invoice.aggregate({
      where: { companyId, ...SALES_RETURN_WHERE(), ...posted },
      _sum: { totalAmount: true },
    }),
    prisma.invoicePayment.aggregate({
      where: {
        companyId,
        invoice: { ...SALES_RETURN_WHERE(), date: until },
        paymentDate: until,
      },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { companyId, ...PURCHASE_RETURN_WHERE(), ...posted },
      _sum: { totalAmount: true },
    }),
    prisma.invoicePayment.aggregate({
      where: {
        companyId,
        invoice: { ...PURCHASE_RETURN_WHERE(), date: until },
        paymentDate: until,
      },
      _sum: { amount: true },
    }),
  ])

  const netReceivables =
    Number(receivableInvoices._sum.totalAmount || 0) -
    Number(receivablePayments._sum.amount || 0) -
    (Number(salesReturns._sum.totalAmount || 0) - Number(salesReturnRefunds._sum.amount || 0))

  const netPayables =
    Number(payableInvoices._sum.totalAmount || 0) -
    Number(payablePayments._sum.amount || 0) -
    (Number(purchaseReturns._sum.totalAmount || 0) - Number(purchaseReturnRefunds._sum.amount || 0))

  // Stok maliyeti YALNIZCA alış fiyatından. Eskiden alış fiyatı yoksa SATIŞ
  // fiyatına düşülüyordu; kâr marjı maliyet sayılınca stok (ve dolayısıyla öz
  // sermaye) sistematik olarak şişiyordu. Maliyeti bilinmeyen ürün 0 sayılır.
  const inventoryValue = inventory.reduce((sum, item) => {
    return sum + Number(item.stockQuantity || 0) * Number(item.purchasePrice ?? 0)
  }, 0)

  return {
    asOfDate: new Date(bounds.endExclusive.getTime() - 1).toISOString(),
    ...composeBalanceSheet({
      cashAndBanks,
      netReceivables,
      netPayables,
      inventory: inventoryValue,
      retainedEarnings: profitLoss.netProfit,
    }),
  }
}
