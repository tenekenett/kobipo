/**
 * Yaşlandırma KOVALARININ sözlüğü — SAF modül.
 *
 * Ayrı dosya çünkü üç yer okuyor: hesap (`cari-yaslandirma.ts`), ekran
 * (`app/(dashboard)/raporlar/cari-yaslandirma/page.tsx`) ve Excel
 * (`lib/export/datasets/reports.ts`). Hesap modülü en üstte Prisma'yı içe
 * aktardığı için ekran oradan sabit alamıyor, dolayısıyla liste ve etiketler
 * ekranda KOPYA duruyordu: kova eklendiğinde biri güncellenip diğeri unutulur.
 */

export type AgingBucket = "not_due" | "d1_30" | "d31_60" | "d61_90" | "d90_plus" | "no_due"

/** Ekranda ve dosyada bu SIRAYLA görünür. */
export const AGING_BUCKETS: AgingBucket[] = [
  "not_due",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_plus",
  "no_due",
]

/** Gecikme ölçülebilen kovalar — "Vadesi Geçmiş" toplamı bunların toplamıdır. */
export const OVERDUE_BUCKETS: AgingBucket[] = ["d1_30", "d31_60", "d61_90", "d90_plus"]

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  not_due: "Vadesi Gelmemiş",
  d1_30: "1-30 Gün",
  d31_60: "31-60 Gün",
  d61_90: "61-90 Gün",
  d90_plus: "90+ Gün",
  no_due: "Vade Tanımsız",
}

/**
 * Gecikme gününü kovaya çevirir. Vade TANIMSIZSA gecikme ölçülemez: vade yerine
 * fatura tarihi kullanılıp belge "gecikmiş" sayılıyordu (ölçümde bir firmanın
 * 241 faturasının yalnız 6'sında vade vardı, yani rapor neredeyse tamamını
 * haksız yere kırmızı gösteriyordu).
 */
export function bucketOf(overdueDays: number, hasDueDate: boolean): AgingBucket {
  if (!hasDueDate) return "no_due"
  if (overdueDays <= 0) return "not_due"
  if (overdueDays <= 30) return "d1_30"
  if (overdueDays <= 60) return "d31_60"
  if (overdueDays <= 90) return "d61_90"
  return "d90_plus"
}
