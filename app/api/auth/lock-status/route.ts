import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getRequestIp } from "@/lib/auth/login-rate-limit"

export const dynamic = "force-dynamic"

/**
 * İsteği yapan IP'nin brute-force lockout durumunu döner ({ locked, retryAfterSeconds }).
 * Signin ekranı, başarısız girişten sonra kullanıcıya net "çok fazla deneme" mesajı göstermek
 * için kullanır. Yalnızca isteğin KENDİ IP'sinin durumunu açıklar (başka hesap/IP sızmaz).
 * FAIL-OPEN: hata/DB sorunu → { locked: false }.
 */
export async function GET(request: Request) {
  try {
    const ip = getRequestIp(Object.fromEntries(request.headers))
    const rec = await prisma.loginAttempt.findUnique({ where: { ip } })
    const now = Date.now()
    if (rec?.lockedUntil && rec.lockedUntil.getTime() > now) {
      return NextResponse.json({
        locked: true,
        retryAfterSeconds: Math.ceil((rec.lockedUntil.getTime() - now) / 1000),
      })
    }
  } catch {
    // fail-open
  }
  return NextResponse.json({ locked: false, retryAfterSeconds: 0 })
}
