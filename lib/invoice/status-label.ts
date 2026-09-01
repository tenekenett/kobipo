/**
 * Fatura durumunun TÜRKÇE etiketi.
 *
 * Durum veritabanında ham kod olarak tutuluyor (`DRAFT`, `GIB_DRAFT`, `SENT`,
 * `CANCELLED`, `CONVERTED`). Rapor dosyalarında bu kodlar müşteriye olduğu gibi
 * gidiyordu — Excel'in "Durum" sütununda "GIB_DRAFT" yazıyordu. Etiket tek yerden
 * verilir ki ekrandaki rozet, liste ve dosya aynı kelimeyi kullansın.
 *
 * ALIŞ tarafında `DRAFT` "Taslak" DEĞİLDİR: alış faturası ALINAN bir belgedir,
 * taslak/onay akışı yoktur — ekrandaki rozet de "Kayıtlı" gösterir
 * (`components/faturalar/faturalar-listing.tsx`).
 */

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
  options?: { isPurchase?: boolean }
): string {
  if (!status) return ""
  const key = status.toUpperCase()
  if (key === "DRAFT" && options?.isPurchase) return "Kayıtlı"
  return LABELS[key] ?? status
}
