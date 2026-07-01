import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

/**
 * Blog editörü yetkisini doğrular (platform seviyesi içerik rolü).
 * Süper admin de blog'u yönetebilir. Yetkili değilse { error } döner.
 *
 * Kullanım:
 *   const auth = await requireBlogEditor()
 *   if ("error" in auth) return auth.error
 *   // auth.user.id ...
 */
export async function requireBlogEditor(): Promise<
  { user: { id: string; email: string } } | { error: NextResponse }
> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, isSuperAdmin: true, isBlogEditor: true },
  })
  if (!user || (!user.isBlogEditor && !user.isSuperAdmin)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { user: { id: user.id, email: user.email } }
}
