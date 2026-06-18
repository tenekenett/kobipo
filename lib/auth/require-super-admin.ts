import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

/**
 * Sistem-admin (süper admin) yetkisini doğrular.
 * Yetkili değilse { error: NextResponse } döner; yetkiliyse { user } döner.
 *
 * Kullanım:
 *   const auth = await requireSuperAdmin()
 *   if ("error" in auth) return auth.error
 *   // auth.user.id ...
 */
export async function requireSuperAdmin(): Promise<
  { user: { id: string; email: string } } | { error: NextResponse }
> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, isSuperAdmin: true },
  })
  if (!user?.isSuperAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { user: { id: user.id, email: user.email } }
}
