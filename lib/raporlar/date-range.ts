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
