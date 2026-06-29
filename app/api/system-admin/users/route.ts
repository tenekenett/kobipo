import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"
import { Role } from "@prisma/client"

export const dynamic = "force-dynamic"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = Object.values(Role) as Role[]

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

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

    const body = await request.json()
    const name = String(body.name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const isSuperAdmin = body.isSuperAdmin === true

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Geçerli bir e-posta girin" }, { status: 400 })
    }

    const dup = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    })
    if (dup) {
      return NextResponse.json(
        { error: "Bu e-posta zaten kullanılıyor" },
        { status: 409 }
      )
    }

    // Opsiyonel: oluşturma sırasında firmaya bağla (companyId + role verilirse).
    const companyId = String(body.companyId ?? "").trim()
    const role = String(body.role ?? "") as Role
    if (companyId) {
      if (!VALID_ROLES.includes(role)) {
        return NextResponse.json({ error: "Geçersiz rol" }, { status: 400 })
      }
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      })
      if (!company) {
        return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })
      }
    }

    // Şifre verilmediyse geçici şifre üret ve response'da döndür.
    const providedPassword = String(body.password ?? "")
    const tempPassword = providedPassword.length >= 6 ? null : Math.random().toString(36).slice(-10)
    const plainPassword = tempPassword ?? providedPassword
    const hashedPassword = await bcrypt.hash(plainPassword, 10)

    const user = await prisma.user.create({
      data: {
        name: name.length > 0 ? name : null,
        email,
        password: hashedPassword,
        isSuperAdmin,
        ...(companyId
          ? {
              companies: {
                create: { companyId, role, invitedBy: currentUser.id, invitedAt: new Date() },
              },
            }
          : {}),
      },
    })

    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: "CREATE_USER",
        entity: "User",
        entityId: user.id,
        details: `Kullanıcı "${user.email}" oluşturuldu`,
        level: "INFO"
      }
    })

    return NextResponse.json(
      {
        success: true,
        userId: user.id,
        // Geçici şifre üretildiyse yöneticiye göster (e-posta servisi yok).
        tempPassword,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Create user error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
