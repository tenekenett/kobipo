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

/**
 * Firma için kullanılacak Mysoft base URL'sini çözer.
 * @param override company.eDonusumApiUrl (veya request body'den gelen apiUrl)
 * @returns override doluysa onun trim'lenmiş hali, aksi halde güvenli TEST varsayılanı.
 */
export function resolveMysoftBaseUrl(override?: string | null): string {
  const trimmed = typeof override === "string" ? override.trim() : ""
  return trimmed || MYSOFT_TEST_URL
}
