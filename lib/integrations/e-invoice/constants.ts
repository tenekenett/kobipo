/**
 * Mysoft eDocument API ortam URL'leri.
 *
 * Ortam seçimi firma bazında `company.eDonusumApiUrl` alanında saklanır ve
 * ayarlar ekranındaki Test/Canlı seçicisiyle yönetilir. Bu alan boşsa kod
 * güvenli varsayılan olarak TEST ortamına düşer — yapılandırılmamış bir firma
 * yanlışlıkla gerçek (GİB'e giden) fatura kesmesin diye fallback canlı DEĞİLDİR.
 */
export const MYSOFT_TEST_URL = "https://edocumentapi.mytest.tr"
export const MYSOFT_PROD_URL = "https://edocumentapi.mysoft.com.tr"

/** Firma kaydında ya da istek gövdesinde bilinmeyen bir Mysoft adresi. */
export class MysoftUrlError extends Error {
  constructor(public readonly received: string) {
    super("Geçersiz Mysoft API adresi: yalnız test ya da canlı ortam seçilebilir")
    this.name = "MysoftUrlError"
  }
}

/**
 * Firma için kullanılacak Mysoft base URL'sini çözer.
 *
 * Yalnız iki bilinen ortam kabul edilir; başka adres HATADIR, sessizce test'e
 * düşmez. Eskiden gelen değer olduğu gibi kullanılıyordu ve `test-mysoft` ucu
 * firmanın KAYITLI (şifreli) Mysoft şifresini çözüp gövdedeki `apiUrl`e POST
 * ediyordu — yazma yetkili herhangi bir üye kendi sunucusunu verip şifreyi
 * alabilirdi; aynı yol iç ağa istek (SSRF) kapısıydı (2026-09-18 taraması).
 * Ayarlar ekranı zaten yalnız bu iki sabiti yazar; DB'de de başka değer yok (ölçüldü).
 *
 * @param override company.eDonusumApiUrl (veya request body'den gelen apiUrl)
 * @returns kanonik ortam adresi; boşsa güvenli TEST varsayılanı.
 */
export function resolveMysoftBaseUrl(override?: string | null): string {
  const trimmed = typeof override === "string" ? override.trim() : ""
  if (!trimmed) return MYSOFT_TEST_URL
  let host: string
  let protocol: string
  try {
    const u = new URL(trimmed)
    host = u.hostname.toLowerCase()
    protocol = u.protocol
  } catch {
    throw new MysoftUrlError(trimmed)
  }
  if (protocol !== "https:") throw new MysoftUrlError(trimmed)
  if (host === new URL(MYSOFT_PROD_URL).hostname) return MYSOFT_PROD_URL
  if (host === new URL(MYSOFT_TEST_URL).hostname) return MYSOFT_TEST_URL
  throw new MysoftUrlError(trimmed)
}
