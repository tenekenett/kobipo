/**
 * Nakit akış tablosunun ARİTMETİĞİ — SAF modül.
 *
 * Ayrı dosya çünkü `nakit-akisi.ts` en üstte Prisma'yı içe aktarıyor ve testin
 * tek derdi olan denge kimliği veritabanına hiç ihtiyaç duymuyor (aynı ayrım
 * `cari-yaslandirma-plan.ts` ve `satis-alis-shared.ts`te de var).
 *
 * KİMLİK: `dönem başı + net akış = dönem sonu`. Net akış, sınıflandırmadan
 * DEĞİL iki bakiyenin farkından gelir; sınıflandırma yalnız o farkı açıklar.
 * Tersi denenmişti (net akış = tahsilat − ödeme + …) ve tablo tutmuyordu:
 * kayıt bırakmayan her hareket (dönem içinde açılan hesabın devri, elle bakiye
 * düzeltmesi) sessizce kayboluyordu.
 */

export type CashFlowInputs = {
  beginningBalance: number
  endingBalance: number
  /** Faturalara karşılık kasaya GİREN para. */
  collections: number
  /** Faturalara karşılık kasadan ÇIKAN para. */
  payments: number
  /** Faturaya bağlı olmayan gelir işlemleri (virman hariç). */
  otherIncome: number
  /** Faturaya bağlı olmayan gider işlemleri (virman hariç). */
  otherExpense: number
}

export type CashFlowSummary = {
  beginningBalance: number
  operatingActivities: {
    collections: number
    payments: number
    otherIncome: number
    otherExpense: number
    net: number
  }
  unclassified: number
  netCashFlow: number
  endingBalance: number
}

export function summarizeCashFlow(input: CashFlowInputs): CashFlowSummary {
  const operatingNet =
    input.collections - input.payments + input.otherIncome - input.otherExpense
  const netCashFlow = input.endingBalance - input.beginningBalance

  return {
    beginningBalance: input.beginningBalance,
    operatingActivities: {
      collections: input.collections,
      payments: input.payments,
      otherIncome: input.otherIncome,
      otherExpense: input.otherExpense,
      net: operatingNet,
    },
    unclassified: netCashFlow - operatingNet,
    netCashFlow,
    endingBalance: input.endingBalance,
  }
}
