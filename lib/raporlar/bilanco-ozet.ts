/**
 * Bilançonun ARİTMETİĞİ — SAF modül.
 *
 * Ayrı dosya çünkü `bilanco.ts` en üstte Prisma'yı içe aktarıyor; testin tek
 * derdi olan `aktif = pasif` kimliği ise veritabanına ihtiyaç duymuyor.
 *
 * ÜÇ KURAL:
 *  1. Öz sermaye TANIMDAN gelir: net varlık = aktif − yükümlülük. Böylece tablo
 *     her zaman denk kapanır; kümülatif kârla açıklanamayan kısım gizlenmez,
 *     "sermaye ve diğer düzeltmeler" satırında görünür.
 *  2. Negatif cari bakiye KIRPILMAZ, karşı tarafa geçer. Müşteri fazla ödediyse
 *     bu bir alacak değil iade edilecek AVANSTIR (yükümlülük); tedarikçiye fazla
 *     ödediysek borç değil VARLIKTIR. Eskiden `> 0 ? : 0` ile sıfırlanıyor ve
 *     para sessizce kayboluyordu.
 *  3. Ayrım CARİ BAŞINADIR (2026-09-23): A müşterisinin avansı B müşterisinin
 *     borcundan düşülmez. Eskiden tüm müşteriler tek net rakamda toplanıyordu;
 *     bir müşterinin fazla ödemesi başkasının alacağını görünmez kılıyordu.
 */

export type BalanceSheetInputs = {
  cashAndBanks: number
  /** Müşteri başına bakiye — + alacak, − alınan avans (lib/cari/bakiye-asof.ts). */
  customerBalances: number[]
  /** Tedarikçi başına bakiye — + borç, − verilen avans. */
  supplierBalances: number[]
  /** Portföydeki alınan çek/senet (lib/raporlar/bilanco-kiymet.ts). */
  checksReceived: number
  /** Henüz ödenmemiş verilen çek/senet. */
  checksGiven: number
  inventory: number
  /** Başlangıçtan bugüne kümülatif net kâr/zarar. */
  retainedEarnings: number
}

export type BalanceSheetSummary = {
  assets: {
    cashAndBanks: number
    receivables: number
    checksReceived: number
    supplierAdvances: number
    inventory: number
    total: number
  }
  liabilities: {
    payables: number
    checksGiven: number
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

const round2 = (n: number) => Math.round(n * 100) / 100
const positives = (xs: number[]) => round2(xs.reduce((s, x) => s + Math.max(x, 0), 0))
const negatives = (xs: number[]) => round2(xs.reduce((s, x) => s + Math.max(-x, 0), 0))

export function composeBalanceSheet(input: BalanceSheetInputs): BalanceSheetSummary {
  const assets = {
    cashAndBanks: input.cashAndBanks,
    receivables: positives(input.customerBalances),
    checksReceived: input.checksReceived,
    supplierAdvances: negatives(input.supplierBalances),
    inventory: input.inventory,
    total: 0,
  }
  assets.total = round2(
    assets.cashAndBanks +
      assets.receivables +
      assets.checksReceived +
      assets.supplierAdvances +
      assets.inventory,
  )

  const liabilities = {
    payables: positives(input.supplierBalances),
    checksGiven: input.checksGiven,
    customerAdvances: negatives(input.customerBalances),
    total: 0,
  }
  liabilities.total = round2(liabilities.payables + liabilities.checksGiven + liabilities.customerAdvances)

  const equityTotal = round2(assets.total - liabilities.total)

  return {
    assets,
    liabilities,
    equity: {
      retainedEarnings: input.retainedEarnings,
      adjustments: round2(equityTotal - input.retainedEarnings),
      total: equityTotal,
    },
    total: assets.total,
    totalLiabilitiesAndEquity: round2(liabilities.total + equityTotal),
  }
}
