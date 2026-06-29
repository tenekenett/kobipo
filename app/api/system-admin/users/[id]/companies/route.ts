import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { Role } from "@prisma/client"

export const dynamic = "force-dynamic"

const VALID_ROLES = Object.values(Role) as Role[]

// Bir kullanıcıyı firmaya bağlar (UserCompany üyeliği oluşturur).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { id: userId } = await params

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { isSuperAdmin: true, id: true },
    })

    if (!currentUser?.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const companyId = String(body.companyId ?? "").trim()
    const role = String(body.role ?? "") as Role

    if (!companyId) {
      return NextResponse.json({ error: "Firma seçilmedi" }, { status: 400 })
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Geçersiz rol" }, { status: 400 })
    }

    const [user, company] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
    ])
    if (!user) {
      return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 })
    }
    if (!company) {
      return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })
    }

    const existing = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: "Kullanıcı bu firmaya zaten bağlı" },
        { status: 409 }
      )
    }

    await prisma.userCompany.create({
      data: {
        userId,
        companyId,
        role,
        invitedBy: currentUser.id,
        invitedAt: new Date(),
      },
    })

    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: "ADD_USER_COMPANY",
        entity: "UserCompany",
        entityId: userId,
        details: `"${user.email}" kullanıcısı "${company.name}" firmasına ${role} rolüyle eklendi`,
        level: "INFO",
      },
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error("Add user-company error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
