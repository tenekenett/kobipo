import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const resolvedParams = await params

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Super admin kontrolü
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { isSuperAdmin: true, id: true }
    })

    if (!currentUser?.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Kendini değiştiremez
    if (currentUser.id === resolvedParams.id) {
      return NextResponse.json({ error: "Kendi yetkinizi değiştiremezsiniz" }, { status: 400 })
    }

    const body = await request.json()
    const { isSuperAdmin } = body

    const user = await prisma.user.update({
      where: { id: resolvedParams.id },
      data: { isSuperAdmin }
    })

    // Log kaydı
    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: isSuperAdmin ? "GRANT_SUPER_ADMIN" : "REVOKE_SUPER_ADMIN",
        entity: "User",
        entityId: user.id,
        details: `Kullanıcı "${user.email}" ${isSuperAdmin ? "super admin yapıldı" : "super admin yetkisi kaldırıldı"}`,
        level: "WARN"
      }
    })

    return NextResponse.json({ success: true, user })
  } catch (error) {
    console.error("Toggle super admin error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

