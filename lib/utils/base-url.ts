/**
 * Bir Request'ten uygulamanın mutlak temel URL'ini çözer.
 * Öncelik: gelen origin başlığı → host (+ x-forwarded-proto) → ortam değişkenleri.
 * Davet / şifre sıfırlama gibi e-posta bağlantılarında kullanılır.
 */
export function resolveBaseUrl(request: Request): string {
  const origin = request.headers.get("origin")
  if (origin) return origin.replace(/\/+$/, "")

  const host = request.headers.get("host")
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") || "https"
    return `${proto}://${host}`.replace(/\/+$/, "")
  }

  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL ||
    "http://localhost:3000"
  return env.replace(/\/+$/, "")
}
