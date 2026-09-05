/**
 * Rapor ekranlarının ORTAK dönem varsayılanı — saf modül.
 *
 * Ayrı dosyada çünkü üç ekran okuyor (satış/alış raporu, bölüm sayfaları, stok
 * hareketleri) ve hiçbiri diğerinin alanına ait değil. Gün biçimi burada
 * yeniden yazılmaz: `toDateInput` (yerel gün) `lib/format.ts`te duruyor ve
 * form ekranları da onu kullanıyor.
 */

import { addDays, toDateInput } from "@/lib/format"

/** Varsayılan dönem kaç günlük. */
export const DEFAULT_REPORT_RANGE_DAYS = 30

/**
 * Ekranların açılışta kullandığı dönem: bitiş BUGÜN, başlangıç 30 gün öncesi.
 *
 * Eskiden başlangıç YILBAŞIYDI; Eylül'de açılan rapor sekiz aylık veriyi çekip
 * "son durum"u boğuyordu. Üstelik gün `toISOString()` ile yazıldığı için UTC'ye
 * kayıyor ve 1 Ocak 2026 varsayılanı kutuda "2025-12-31" görünüyordu.
 */
export function defaultReportRange(today: Date = new Date()): { startDate: string; endDate: string } {
  return {
    startDate: toDateInput(addDays(today, -DEFAULT_REPORT_RANGE_DAYS)),
    endDate: toDateInput(today),
  }
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Dönemin İKİ UCU da `Date` olarak — bitiş DIŞLAYICI.
 *
 * `resolveReportDateFilter` (satis-alis-shared) doğrudan bir Prisma `where`
 * parçası üretir; mali tablolarda ise sınırların kendisi gerekiyor çünkü dönem
 * başı/sonu bakiyesi "şu andan şu ana kadarki hareketi geri sar" diye
 * hesaplanıyor (bkz. lib/finans/nakit-hareket.ts).
 *
 * Bitiş dışlayıcı ("<") çünkü kutudan gelen `2026-09-05` günün TAMAMINI
 * kapsamalı: `lte: new Date("2026-09-05")` gece yarısını işaret eder ve o günün
 * bütün hareketlerini rapordan düşürür.
 */
export function resolvePeriodBounds(
  startDate?: string | null,
  endDate?: string | null,
  today: Date = new Date()
): { start: Date; endExclusive: Date } {
  const start = startDate
    ? new Date(DAY_ONLY.test(startDate) ? `${startDate}T00:00:00.000Z` : startDate)
    : new Date(Date.UTC(today.getFullYear(), 0, 1))

  let endExclusive: Date
  if (!endDate) {
    endExclusive = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 1))
  } else if (DAY_ONLY.test(endDate)) {
    endExclusive = new Date(`${endDate}T00:00:00.000Z`)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
  } else {
    // Saat taşıyan değer olduğu gibi uygulanır (uca elle verilebilir).
    endExclusive = new Date(endDate)
  }

  return { start, endExclusive }
}

/** `resolvePeriodBounds` sonucundan Prisma tarih süzgeci. */
export function periodWhere(bounds: { start: Date; endExclusive: Date }) {
  return { gte: bounds.start, lt: bounds.endExclusive }
}
