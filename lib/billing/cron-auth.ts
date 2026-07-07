import crypto from "node:crypto"

/**
 * Cron/sistem uçlarının (reconcile, recurring) paylaşılan gizli anahtar doğrulaması.
 *
 * `BILLING_CRON_SECRET` env değişkeni ile korunur. İstek header'ında
 * `Authorization: Bearer <secret>` veya `x-cron-secret: <secret>` beklenir; timing-safe
 * karşılaştırılır. Secret tanımsızsa erişim REDDEDİLİR (fail closed) — böylece yanlış
 * yapılandırmada uç herkese açık kalmaz.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.BILLING_CRON_SECRET?.trim()
  if (!secret) return false

  const auth = request.headers.get("authorization") || ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  const provided = bearer || request.headers.get("x-cron-secret")?.trim() || ""
  if (!provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
