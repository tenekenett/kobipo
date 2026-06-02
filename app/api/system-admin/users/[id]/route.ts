import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const resolvedParams = await params

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { isSuperAdmin: true, id: true }
    })

    if (!currentUser?.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const existing = await prisma.user.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true }
    })
    if (!existing) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 })
    }

    const body = await request.json()
    const name = String(body.name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Geçerli bir e-posta girin" }, { status: 400 })
    }

    // E-posta benzersiz; başka kullanıcıda varsa hata.
    const dup = await prisma.user.findFirst({
      where: { email, NOT: { id: resolvedParams.id } },
      select: { id: true }
    })
    if (dup) {
      return NextResponse.json(
        { error: "Bu e-posta başka bir kullanıcıda kayıtlı" },
        { status: 409 }
      )
    }

    // super-admin yetkisi düzenlemede de değiştirilebilir, ancak kullanıcı
    // kendi yetkisini kaldıramaz (yanlışlıkla kilitlenmeyi önler).
    const data: { name: string | null; email: string; isSuperAdmin?: boolean } = {
      name: name.length > 0 ? name : null,
      email,
    }
    if (typeof body.isSuperAdmin === "boolean" && currentUser.id !== resolvedParams.id) {
      data.isSuperAdmin = body.isSuperAdmin
    }

    const user = await prisma.user.update({
      where: { id: resolvedParams.id },
      data,
    })

    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: "UPDATE_USER",
        entity: "User",
        entityId: user.id,
        details: `Kullanıcı "${user.email}" bilgileri güncellendi`,
        level: "INFO"
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Update user error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
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

    // Kendini silemez
    if (currentUser.id === resolvedParams.id) {
      return NextResponse.json(
        { error: "Kendi hesabınızı silemezsiniz" },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true, email: true }
    })

    if (!user) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 })
    }

    // İlişkili kayıtlar (oturum, hesap, firma bağlantısı vb.) onDelete: Cascade
    // ile, sistem logları ise SetNull ile yönetilir.
    await prisma.user.delete({ where: { id: user.id } })

    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: "DELETE_USER",
        entity: "User",
        entityId: user.id,
        details: `Kullanıcı "${user.email}" silindi`,
        level: "WARN"
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete user error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
