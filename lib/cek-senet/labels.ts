/**
 * Çek/senet durum ve yön etiketleri — TEK KAYNAK.
 *
 * Etiketler hem portföy ekranında hem makbuz PDF'inde basılıyor; iki yerde ayrı
 * map tutmak "ekranda Portföyde, makbuzda PORTFÖYDE" gibi sapmalar üretir.
 */

export const CEK_SENET_STATUSES = [
  "PORTFÖYDE",
  "CİRO_EDİLDİ",
  "TAHSİL_EDİLDİ",
  "İADE_EDİLDİ",
  "PROTESTOLU",
] as const

const STATUS_LABELS: Record<string, string> = {
  PORTFÖYDE: "Portföyde",
  CİRO_EDİLDİ: "Ciro Edildi",
  TAHSİL_EDİLDİ: "Tahsil Edildi",
  İADE_EDİLDİ: "İade Edildi",
  PROTESTOLU: "Protestolu",
}

export const cekSenetStatusLabel = (status: string) => STATUS_LABELS[status] ?? status

/**
 * Alınan mı verilen mi?
 *
 * `direction` alanı sonradan eklendi; eski kayıtlarda null. Şema notundaki kural:
 * tedarikçiye bağlıysa verilen, aksi halde alınan. Aynı düşüş kuralı ekranda ve
 * makbuzda kullanılıyor — biri diğerinden ayrılırsa aynı çek listede "alınan",
 * makbuzda "verilen" görünür.
 */
export function resolveCekSenetDirection(item: {
  direction?: string | null
  supplierId?: string | null
}): "RECEIVED" | "GIVEN" {
  if (item.direction === "GIVEN" || item.direction === "RECEIVED") return item.direction
  return item.supplierId ? "GIVEN" : "RECEIVED"
}
