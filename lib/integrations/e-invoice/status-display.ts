// Mysoft invoiceStatusText → görsel sınıflandırma + Türkçe etiket
// Hem /faturalar/[id]/onizleme hem /e-donusum/[id] sayfaları kullanır.

export type GibBucket = "approved" | "rejected" | "cancelled" | "processing" | "unknown"

export const GIB_STATUS_MAP: Record<string, { bucket: GibBucket; label: string }> = {
  BOS: { bucket: "processing", label: "Henüz işlem yok" },
  IPTAL_EDILDI: { bucket: "cancelled", label: "İptal edildi" },
  TASLAK: { bucket: "processing", label: "Taslak (Mysoft)" },
  ARSIV_KAYIT_KUYRUGUNDA: { bucket: "processing", label: "Arşiv kuyruğunda" },
  GIBE_GONDERILECEK: { bucket: "processing", label: "GİB'e gönderilecek" },
  GIBE_GONDERILDI: { bucket: "processing", label: "GİB'e gönderildi" },
  ALICIYA_ULASTI: { bucket: "approved", label: "Alıcıya ulaştı" },
  KABUL_KUYRUGUNDA: { bucket: "processing", label: "Kabul kuyruğunda" },
  RED_KUYRUGUNDA: { bucket: "processing", label: "Red kuyruğunda" },
  YANIT_BEKLENIYOR: { bucket: "processing", label: "Yanıt bekleniyor" },
  KABUL: { bucket: "approved", label: "Kabul edildi" },
  RED: { bucket: "rejected", label: "Reddedildi" },
  HATA: { bucket: "rejected", label: "Hata" },
  ONAYLANDI: { bucket: "approved", label: "Onaylandı" },
}

export interface ParsedGibStatus {
  bucket: GibBucket
  label: string
  detail: string | null
}

export function parseGibStatus(integrationStatus: string | null | undefined): ParsedGibStatus | null {
  if (!integrationStatus) return null
  // Format: "BUCKET:rawText" (ör. "APPROVED:ONAYLANDI") veya doğrudan "ERROR:..." / "SENT"
  if (integrationStatus.startsWith("ERROR:")) {
    return { bucket: "rejected", label: "Hata", detail: integrationStatus.slice(6) }
  }
  const colonIdx = integrationStatus.indexOf(":")
  const raw = (colonIdx >= 0 ? integrationStatus.slice(colonIdx + 1) : integrationStatus).trim().toUpperCase()
  const known = GIB_STATUS_MAP[raw]
  if (known) return { bucket: known.bucket, label: known.label, detail: null }
  return { bucket: "unknown", label: integrationStatus, detail: null }
}
