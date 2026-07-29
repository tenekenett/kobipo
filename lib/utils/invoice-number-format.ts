/**
 * Fatura No biçim kuralları — SUNUCU VE İSTEMCİ ORTAK.
 *
 * ÖNEMLİ: Bu dosya `@/lib/db/prisma` gibi SUNUCUYA ÖZEL hiçbir şey import ETMEZ.
 * Kurallar önce `invoice-number.ts` içindeydi; o dosya en üstte prisma'yı çekiyor.
 * Client component (fatura editörü) oradan sabit import edince Prisma istemci
 * paketine girip tarayıcıda "DATABASE_URL is not set" hatası veriyordu.
 * Editör ve API artık ikisi de buradan okur, kural tek yerde kalır.
 */

/**
 * Elle girilen Fatura No için üst sınır.
 *
 * GİB e-Belge numarası 16 karakterdir (3 harf önek + 4 hane yıl + 9 hane sıra) ama
 * bu alan e-belgede kullanılmaz — orada numarayı Mysoft üretir. Buradaki değer
 * MANUEL belgelerde bizim iç numaramız ya da ALIŞ faturasında tedarikçinin kendi
 * numarasıdır; tedarikçi numaraları 16 haneyi aşabildiği için biraz geniş tutuldu.
 */
export const INVOICE_NO_MAX_LENGTH = 32

/** İzinli karakterler: harf (Türkçe dahil), rakam, boşluk ve - _ / . ( ) */
export const INVOICE_NO_ALLOWED = /^[\p{L}\p{N}\-_/.() ]+$/u

export type ManualInvoiceNoResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

/**
 * Kullanıcının girdiği Fatura No'yu normalize eder ve doğrular.
 *
 * - Boş / yalnız boşluk → null döner (çağıran otomatik numara üretir)
 * - Baş-son boşluk kırpılır, yatay boşluk dizileri tek boşluğa iner
 * - İçeride satır sonu kalırsa reddedilir (çok satırlı yanlış yapıştırma)
 * - Uzunluk ve karakter kümesi kontrol edilir
 */
export function normalizeManualInvoiceNo(raw: unknown): ManualInvoiceNoResult {
  if (typeof raw !== "string") return { ok: true, value: null }

  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null }

  // Satır sonu KALIRSA reddet: baştaki/sondaki kopyalama artığı zaten trim'lendi,
  // içeride kalan satır sonu çok satırlı yanlış yapıştırma demektir. Boşluğa
  // çevirip kabul etmek iki ayrı değeri sessizce tek numaraya birleştirirdi.
  if (/[\r\n]/.test(trimmed)) {
    return { ok: false, error: "Fatura No tek satır olmalı." }
  }

  // Yatay boşluk dizileri (sekme, çoklu boşluk) tek boşluğa indirilir.
  const value = trimmed.replace(/\s+/g, " ")

  if (value.length > INVOICE_NO_MAX_LENGTH) {
    return {
      ok: false,
      error: `Fatura No en fazla ${INVOICE_NO_MAX_LENGTH} karakter olabilir (girilen: ${value.length}).`,
    }
  }
  if (!INVOICE_NO_ALLOWED.test(value)) {
    return {
      ok: false,
      error: "Fatura No yalnızca harf, rakam ve - _ / . ( ) karakterlerini içerebilir.",
    }
  }
  return { ok: true, value }
}
