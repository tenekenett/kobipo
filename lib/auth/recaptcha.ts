// Google reCAPTCHA v2 (checkbox) sunucu tarafı doğrulaması.
//
// Ortam değişkenleri:
//   RECAPTCHA_SECRET_KEY        → Google'dan alınan gizli anahtar (sunucu)
//   NEXT_PUBLIC_RECAPTCHA_SITE_KEY → site anahtarı (istemci, widget için)
//
// Gizli anahtar tanımlı değilse doğrulama "devre dışı" sayılır ve true döner;
// bu sayede anahtar girilmeden (örn. lokal geliştirme) login/register bozulmaz.

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"

export function isRecaptchaEnabled(): boolean {
  return Boolean(process.env.RECAPTCHA_SECRET_KEY)
}

/**
 * reCAPTCHA token'ını Google'a doğrulatır.
 * @param token  İstemcideki widget'tan gelen response token'ı
 * @param remoteIp  (opsiyonel) kullanıcının IP'si
 * @returns Doğrulama başarılıysa true. Anahtar tanımlı değilse her zaman true.
 */
export async function verifyRecaptcha(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY
  // Anahtar yoksa doğrulama devre dışı.
  if (!secret) return true

  if (!token) return false

  try {
    const params = new URLSearchParams()
    params.append("secret", secret)
    params.append("response", token)
    if (remoteIp) params.append("remoteip", remoteIp)

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      // Google'a giden bu istek cache'lenmemeli.
      cache: "no-store",
    })

    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return Boolean(data.success)
  } catch (error) {
    console.error("reCAPTCHA verify error:", error)
    return false
  }
}
