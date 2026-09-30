/**
 * Fatura durumunun TÜRKÇE etiketi.
 *
 * Durum veritabanında ham kod olarak tutuluyor (`DRAFT`, `GIB_DRAFT`, `SENT`,
 * `CANCELLED`, `CONVERTED`). Rapor dosyalarında bu kodlar müşteriye olduğu gibi
 * gidiyordu — Excel'in "Durum" sütununda "GIB_DRAFT" yazıyordu. Etiket tek yerden
 * verilir ki ekrandaki rozet, liste ve dosya aynı kelimeyi kullansın.
 *
 * `DRAFT` HER ZAMAN "Taslak" DEĞİLDİR — bkz. `kaydedildigindeKesinlesir`.
 */

/**
 * Belge KAYDEDİLDİĞİ AN kesinleşir mi? Öyleyse `DRAFT` durumu "Kayıtlı" okunur.
 *
 *   - ALIŞ ailesi: alış faturası ALINAN bir belgedir, taslak/onay akışı yoktur.
 *   - MANUEL belge (kâğıt/matbu fatura, belge taramayla okutulan fatura,
 *     e-Dönüşümü kapalı firmanın faturası): GİB'e Kobipo üzerinden gitmez;
 *     kaydedildiğinde müşteriye verilmiş bir belgedir. Karar 2026-09-30: "Onayla"
 *     (DRAFT → SENT) adımı kaldırıldı — ölçümde 36 manuel satıştan yalnız 4'ü
 *     onaylanmıştı, kalan 32'si "hiç faturalanmadı" kartına düşüyordu.
 *
 * Yalnız e-Fatura/e-Arşiv satışında `DRAFT` gerçekten taslaktır (GİB'e gitmedi).
 * KDV kuralı (`lib/raporlar/kdv-kural.ts`) aynı tanımı kullanır.
 */
export function kaydedildigindeKesinlesir(b: { isPurchase?: boolean; invoiceType?: string | null }): boolean {
  if (b.isPurchase) return true
  return String(b.invoiceType || "").toUpperCase() === "MANUAL"
}

const LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  GIB_DRAFT: "GİB Taslağı",
  SENT: "Gönderildi",
  APPROVED: "Onaylandı",
  KABUL: "Kabul",
  REJECTED: "Reddedildi",
  RED: "Reddedildi",
  CANCELLED: "İptal",
  CONVERTED: "Dönüştürüldü",
  EXPIRED: "Süresi doldu",
}

export function invoiceStatusLabel(
  status: string | null | undefined,
  options?: { isPurchase?: boolean; invoiceType?: string | null }
): string {
  if (!status) return ""
  const key = status.toUpperCase()
  if (key === "DRAFT" && kaydedildigindeKesinlesir(options ?? {})) return "Kayıtlı"
  return LABELS[key] ?? status
}
