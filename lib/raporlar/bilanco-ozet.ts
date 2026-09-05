/**
 * Bilançonun ARİTMETİĞİ — SAF modül.
 *
 * Ayrı dosya çünkü `bilanco.ts` en üstte Prisma'yı içe aktarıyor; testin tek
 * derdi olan `aktif = pasif` kimliği ise veritabanına ihtiyaç duymuyor.
 *
 * İKİ KURAL:
 *  1. Öz sermaye TANIMDAN gelir: net varlık = aktif − yükümlülük. Böylece tablo
 *     her zaman denk kapanır; kümülatif kârla açıklanamayan kısım gizlenmez,
 *     "sermaye ve diğer düzeltmeler" satırında görünür.
 *  2. Negatif cari bakiye KIRPILMAZ, karşı tarafa geçer. Müşteri fazla ödediyse
 *     bu bir alacak değil iade edilecek AVANSTIR (yükümlülük); tedarikçiye fazla
 *     ödediysek borç değil VARLIKTIR. Eskiden `> 0 ? : 0` ile sıfırlanıyor ve
 *     para sessizce kayboluyordu.
 */

export type BalanceSheetInputs = {
  cashAndBanks: number
  /** Müşteri tarafı net bakiye — EKSİ olabilir (alınan avans). */
  netReceivables: number
  /** Tedarikçi tarafı net bakiye — EKSİ olabilir (verilen avans). */
  netPayables: number
  inventory: number
  /** Başlangıçtan bugüne kümülatif net kâr/zarar. */
  retainedEarnings: number
}

export type BalanceSheetSummary = {
  assets: {
    cashAndBanks: number
    receivables: number
    supplierAdvances: number
    inventory: number
    total: number
  }
  liabilities: {
    payables: number
    customerAdvances: number
    total: number
  }
  equity: {
    retainedEarnings: number
    adjustments: number
    total: number
  }
  total: number
  totalLiabilitiesAndEquity: number
}

export function composeBalanceSheet(input: BalanceSheetInputs): BalanceSheetSummary {
  const assets = {
    cashAndBanks: input.cashAndBanks,
    receivables: Math.max(input.netReceivables, 0),
    supplierAdvances: Math.max(-input.netPayables, 0),
    inventory: input.inventory,
    total: 0,
  }
  assets.total =
    assets.cashAndBanks + assets.receivables + assets.supplierAdvances + assets.inventory

  const liabilities = {
    payables: Math.max(input.netPayables, 0),
    customerAdvances: Math.max(-input.netReceivables, 0),
    total: 0,
  }
  liabilities.total = liabilities.payables + liabilities.customerAdvances

  const equityTotal = assets.total - liabilities.total

  return {
    assets,
    liabilities,
    equity: {
      retainedEarnings: input.retainedEarnings,
      adjustments: equityTotal - input.retainedEarnings,
      total: equityTotal,
    },
    total: assets.total,
    totalLiabilitiesAndEquity: liabilities.total + equityTotal,
  }
}
