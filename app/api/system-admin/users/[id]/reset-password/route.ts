import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"

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

    // Yeni geçici şifre oluştur
    const tempPassword = Math.random().toString(36).slice(-8)
    const hashedPassword = await bcrypt.hash(tempPassword, 10)

    const user = await prisma.user.update({
      where: { id: resolvedParams.id },
      data: { password: hashedPassword }
    })

    // Log kaydı
    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: "RESET_PASSWORD",
        entity: "User",
        entityId: user.id,
        details: `Kullanıcı "${user.email}" şifresi sıfırlandı`,
        level: "WARN"
      }
    })

    // Gerçek uygulamada email gönderilir
    // Şimdilik geçici şifreyi response'da döndürüyoruz
    return NextResponse.json({ 
      success: true, 
      tempPassword,
      message: "Şifre sıfırlandı. Geçici şifre: " + tempPassword
    })
  } catch (error) {
    console.error("Reset password error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

