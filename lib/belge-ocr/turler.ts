/**
 * Belge tarama — ORTAK tipler. İstemci de okur: burada sharp/unpdf/Prisma YOK.
 *
 * Tür kümesi sınıflandırıcının (sinif/schema.ts) verdiği ve onay kartlarının
 * anladığı tek kümedir. Yeni tür eklemek = buraya + sinif prompt'una + türün
 * kendi klasörüne (schema/validate/to-*) + onay kartına.
 */

export const BELGE_TURLERI = ["FIS", "FATURA", "IRSALIYE", "DEKONT", "CEK", "SENET", "DIGER"] as const
export type BelgeTuru = (typeof BELGE_TURLERI)[number]

export const BELGE_TURU_ETIKETI: Record<BelgeTuru, string> = {
  FIS: "Fiş",
  FATURA: "Fatura",
  IRSALIYE: "İrsaliye",
  DEKONT: "Dekont",
  CEK: "Çek",
  SENET: "Senet",
  DIGER: "Diğer",
}

/**
 * Belgenin bize göre yönü. KODDA türetilir (firma VKN/ünvanı ile karşılaştırma),
 * modele sorulmaz — model "bu firma benim" bilgisine sahip değil.
 *
 *   ALIS   → belgeyi karşı taraf düzenledi, biz muhatabız: alış faturası, alış
 *            irsaliyesi, aldığımız çek, hesabımıza gelen havale (tahsilat)
 *   SATIS  → biz düzenledik: satış faturası kopyası, satış irsaliyesi, verdiğimiz
 *            çek, hesabımızdan çıkan havale (ödeme)
 */
export type Yon = "ALIS" | "SATIS" | "BELIRSIZ"

export const YON_ETIKETI: Record<Yon, string> = {
  ALIS: "Alış",
  SATIS: "Satış",
  BELIRSIZ: "Yön belirsiz",
}

/** Belgenin hangi kanaldan okunduğu — kart rozetinde ve ölçümde görünür. */
export type OkumaYolu = "xml" | "karekod+model" | "metin" | "gorsel"

export type Denetim = {
  anahtar: string
  etiket: string
  durum: "gecti" | "patladi" | "olcelemedi"
  aciklama: string
}

export type TaramaDurumu =
  | "PENDING"
  | "READING"
  | "AWAITING_APPROVAL"
  | "SAVED"
  | "REJECTED"
  | "FAILED"

export const TARAMA_DURUMU_ETIKETI: Record<TaramaDurumu, string> = {
  PENDING: "Bekliyor",
  READING: "Okunuyor",
  AWAITING_APPROVAL: "Onay bekliyor",
  SAVED: "Kaydedildi",
  REJECTED: "Reddedildi",
  FAILED: "Hata",
}

/** Kaydedilen hedefin türü (document_scans.targetType) */
export type HedefTuru = "INVOICE" | "WAYBILL" | "PAYMENT" | "CHECK" | "PROMISSORY_NOTE"

export type Olcum = {
  model: string
  saglayici: string
  sureMs: number
  kullanim: { girdiToken: number; ciktiToken: number; dusunmeToken: number; maliyetUsd: number | null }
  sayfa: number
  yol: OkumaYolu
}
