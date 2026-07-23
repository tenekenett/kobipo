import { prisma } from "@/lib/db/prisma"

/**
 * DB-tabanlı brute-force lockout (IP bazlı). Vercel serverless'ta instance'lar arası
 * paylaşılan state için Postgres kullanır ([[login_attempts]] tablosu).
 *
 * TASARIM: Tüm fonksiyonlar FAIL-OPEN'dır — tablo/DB erişilemezse giriş ENGELLENMEZ
 * (kilit birincil auth değil, ek savunma katmanıdır). Böylece rate-limit katmanındaki
 * bir arıza tüm kullanıcıları kilitleyemez.
 */

const MAX_FAILURES = 5 // pencere içinde izin verilen başarısız deneme
const WINDOW_MS = 15 * 60 * 1000 // sayaç penceresi: 15 dk
const LOCK_MS = 15 * 60 * 1000 // eşik aşılınca kilit süresi: 15 dk

/** İstek header'larından istemci IP'sini çözer (Vercel: x-forwarded-for). */
export function getRequestIp(headers: Record<string, string> | undefined | null): string {
  const h = headers || {}
  const xff = (h["x-forwarded-for"] || h["X-Forwarded-For"] || "").toString()
  const first = xff.split(",")[0]?.trim()
  return first || (h["x-real-ip"] || h["X-Real-Ip"] || "").toString().trim() || "unknown"
}

/** IP şu an kilitli mi? Hata → false (fail-open). */
export async function isLoginLocked(ip: string): Promise<boolean> {
  try {
    const rec = await prisma.loginAttempt.findUnique({ where: { ip } })
    return Boolean(rec?.lockedUntil && rec.lockedUntil > new Date())
  } catch {
    return false
  }
}

/** Başarısız denemeyi kaydet; pencere içinde eşik aşılırsa IP'yi kilitle. Hata → yut. */
export async function recordLoginFailure(ip: string, email?: string | null): Promise<void> {
  try {
    const now = new Date()
    const rec = await prisma.loginAttempt.findUnique({ where: { ip } })
    if (!rec) {
      await prisma.loginAttempt.create({
        data: { ip, failedCount: 1, windowStart: now, lastEmail: email ?? null },
      })
      return
    }
    const windowExpired = now.getTime() - rec.windowStart.getTime() > WINDOW_MS
    const nextCount = windowExpired ? 1 : rec.failedCount + 1
    const lockedUntil =
      nextCount >= MAX_FAILURES
        ? new Date(now.getTime() + LOCK_MS)
        : windowExpired
          ? null
          : rec.lockedUntil
    await prisma.loginAttempt.update({
      where: { ip },
      data: {
        failedCount: nextCount,
        windowStart: windowExpired ? now : rec.windowStart,
        lockedUntil,
        lastEmail: email ?? rec.lastEmail,
      },
    })
  } catch {
    // fail-open
  }
}

/** Başarılı girişte IP sayacını sıfırla. Hata → yut. */
export async function clearLoginFailures(ip: string): Promise<void> {
  try {
    await prisma.loginAttempt.deleteMany({ where: { ip } })
  } catch {
    // yut
  }
}
