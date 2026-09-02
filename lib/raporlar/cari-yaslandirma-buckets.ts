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

/**
 * Kova adları. Gecikme kovalarında "Gecikmiş" kelimesi ZORUNLU: çıplak "1-30 Gün"
 * başlığı, vadesi önümüzdeki 30 günde DOLACAK tutar diye okunuyordu. Ölçü tam
 * tersidir — vadesi 1-30 gün ÖNCE dolmuş tutar. Yaklaşan vadelerin tamamı,
 * tarihi ne olursa olsun, "Vadesi Gelmemiş"te toplanır.
 *
 * Etiket ekranda (özet kartı, tablo başlığı, kalem rozeti) ve Excel'de aynı
 * yerden okunur; biri değişip diğeri unutulmasın diye tek sözlükte durur.
 */
export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  not_due: "Vadesi Gelmemiş",
  d1_30: "1-30 Gün Gecikmiş",
  d31_60: "31-60 Gün Gecikmiş",
  d61_90: "61-90 Gün Gecikmiş",
  d90_plus: "90+ Gün Gecikmiş",
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

/**
 * VADE PENCERESİ — ileri yönlü eksen: vadesi HENÜZ GELMEMİŞ tutarın ne zaman
 * tahsil edileceği.
 *
 * Gecikme kovalarıyla (`AgingBucket`) karıştırılmamalı; ikisi zıt yöne bakar:
 * kova "vadesi kaç gün ÖNCE doldu", pencere "vadesi kaç gün SONRA dolacak".
 * Tabloda ileri yön öncelikli çünkü asıl soru "ne zaman ne kadar tahsilat
 * geliyor"; vadesi ileride olan her tutar tek bir "Vadesi Gelmemiş" kolonunda
 * toplanınca 4 Eylül vadeli fatura ile 9 Ekim vadeli fatura ayırt edilemiyordu.
 */
export type DueWindow = "w0_30" | "w31_60" | "w61_90" | "w90_plus"

/** Ekranda ve dosyada bu SIRAYLA görünür. */
export const DUE_WINDOWS: DueWindow[] = ["w0_30", "w31_60", "w61_90", "w90_plus"]

export const DUE_WINDOW_LABEL: Record<DueWindow, string> = {
  w0_30: "0-30 Gün İçinde",
  w31_60: "31-60 Gün İçinde",
  w61_90: "61-90 Gün İçinde",
  w90_plus: "90+ Gün Sonra",
}

/**
 * Vadeye KALAN günü pencereye çevirir. Yalnız `not_due` kalemler için anlamlıdır:
 * gecikmiş ya da vadesi tanımsız belgenin penceresi yoktur.
 */
export function dueWindowOf(daysUntilDue: number): DueWindow {
  if (daysUntilDue <= 30) return "w0_30"
  if (daysUntilDue <= 60) return "w31_60"
  if (daysUntilDue <= 90) return "w61_90"
  return "w90_plus"
}
