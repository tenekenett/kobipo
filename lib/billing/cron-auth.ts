import crypto from "node:crypto"

/**
 * Cron/sistem uçlarının (reconcile, recurring) paylaşılan gizli anahtar doğrulaması.
 *
 * `BILLING_CRON_SECRET` env değişkeni ile korunur. İstek header'ında
 * `Authorization: Bearer <secret>` veya `x-cron-secret: <secret>` beklenir; timing-safe
 * karşılaştırılır. Secret tanımsızsa erişim REDDEDİLİR (fail closed) — böylece yanlış
 * yapılandırmada uç herkese açık kalmaz.
 *
 * `CRON_SECRET` de kabul edilir: Vercel Cron zamanlanmış istekte `Authorization: Bearer
 * $CRON_SECRET` header'ını KENDİSİ ekler ve adı sabittir. İkisini de kabul etmek, aynı
 * gizli değeri iki ayrı env'e kopyalamaktan iyidir. İkisi de tanımlıysa ikisi de geçerlidir.
 */
export function isCronAuthorized(request: Request): boolean {
  const secrets = [process.env.BILLING_CRON_SECRET, process.env.CRON_SECRET]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
  if (secrets.length === 0) return false

  const auth = request.headers.get("authorization") || ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  const provided = bearer || request.headers.get("x-cron-secret")?.trim() || ""
  if (!provided) return false

  const a = Buffer.from(provided)
  // `some` ile kısa devre yapmıyoruz: her iki karşılaştırma da timing-safe kalsın.
  return secrets.reduce((ok, secret) => {
    const b = Buffer.from(secret)
    return (a.length === b.length && crypto.timingSafeEqual(a, b)) || ok
  }, false)
}
