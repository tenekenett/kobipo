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
  /**
   * Çalışan başına masraf defteri bakiyesi — + firmanın çalışana borcu (cebinden
   * ödenen fatura), − çalışanın firmaya borcu (lib/personel/masraf-defteri.ts).
   * Cari gibi KİŞİ BAŞINA ayrılır; verilmezse boş sayılır.
   */
  employeeBalances?: number[]
  inventory: number
  /** Başlangıçtan bugüne kümülatif net kâr/zarar. */
  retainedEarnings: number
  /**
   * Türlü hareketler (lib/finans/hareket-turu.ts, 2026-10-09). Kâr/zarara girmezler;
   * burada sayılmasalar kredi parası kasada görünür ama borcu "sermaye düzeltmesi"
   * satırında kaybolurdu.
   *   loans          kullanılan − ödenen kredi anaparası (+ borç)
   *   partnerBalance ortaktan gelen − ortağa ödenen (+ ortağa borç, − ortaktan alacak)
   *   employeeAdvances çalışan başına açık avans (+ personelden alacak)
   */
  loans?: number
  partnerBalance?: number
  employeeAdvances?: number[]
}

export type BalanceSheetSummary = {
  assets: {
    cashAndBanks: number
    receivables: number
    checksReceived: number
    supplierAdvances: number
    employeeReceivables: number
    employeeAdvances: number
    partnerReceivables: number
    inventory: number
    total: number
  }
  liabilities: {
    payables: number
    checksGiven: number
    customerAdvances: number
    employeePayables: number
    loans: number
    partnerPayables: number
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
  const employeeBalances = input.employeeBalances ?? []
  const assets = {
    cashAndBanks: input.cashAndBanks,
    receivables: positives(input.customerBalances),
    checksReceived: input.checksReceived,
    supplierAdvances: negatives(input.supplierBalances),
    employeeReceivables: negatives(employeeBalances),
    // Avans bakiyesi kişi başına; eksi (fazla mahsup) kırpılmaz, personele borç olur.
    employeeAdvances: positives(input.employeeAdvances ?? []),
    partnerReceivables: round2(Math.max(-(input.partnerBalance ?? 0), 0)),
    inventory: input.inventory,
    total: 0,
  }
  assets.total = round2(
    assets.cashAndBanks +
      assets.receivables +
      assets.checksReceived +
      assets.supplierAdvances +
      assets.employeeReceivables +
      assets.employeeAdvances +
      assets.partnerReceivables +
      assets.inventory,
  )

  const liabilities = {
    payables: positives(input.supplierBalances),
    checksGiven: input.checksGiven,
    customerAdvances: negatives(input.customerBalances),
    employeePayables: round2(positives(employeeBalances) + negatives(input.employeeAdvances ?? [])),
    loans: round2(input.loans ?? 0),
    partnerPayables: round2(Math.max(input.partnerBalance ?? 0, 0)),
    total: 0,
  }
  liabilities.total = round2(
    liabilities.payables +
      liabilities.checksGiven +
      liabilities.customerAdvances +
      liabilities.employeePayables +
      liabilities.loans +
      liabilities.partnerPayables,
  )

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
