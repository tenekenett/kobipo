import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { Role } from "@prisma/client"
import { withMembershipLog } from "@/lib/audit/permission-log.server"

export const dynamic = "force-dynamic"

const VALID_ROLES = Object.values(Role) as Role[]

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return { error: "Unauthorized", status: 401 as const }
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { isSuperAdmin: true, id: true },
  })
  if (!currentUser?.isSuperAdmin) return { error: "Forbidden", status: 403 as const }
  return { currentUser }
}

// Kullanıcının bir firmadaki rolünü günceller.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; companyId: string }> }
) {
  try {
    const { id: userId, companyId } = await params
    const auth = await requireSuperAdmin()
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json()
    const role = String(body.role ?? "") as Role
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Geçersiz rol" }, { status: 400 })
    }

    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { id: true },
    })
    if (!membership) {
      return NextResponse.json({ error: "Üyelik bulunamadı" }, { status: 404 })
    }

    // Kayıt (önce/sonra) yetki günlüğünden geçer: firma ekranlarındaki değişikliklerle
    // aynı biçimde, aynı eylem adıyla (UPDATE_USER_COMPANY).
    await withMembershipLog(
      { actorUserId: auth.currentUser.id, companyId, memberUserId: userId, via: "Sistem yönetimi" },
      () =>
        prisma.userCompany.update({
          where: { userId_companyId: { userId, companyId } },
          data: { role },
        })
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Update user-company error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Kullanıcının firma bağlantısını kaldırır.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; companyId: string }> }
) {
  try {
    const { id: userId, companyId } = await params
    const auth = await requireSuperAdmin()
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { id: true },
    })
    if (!membership) {
      return NextResponse.json({ error: "Üyelik bulunamadı" }, { status: 404 })
    }

    await withMembershipLog(
      { actorUserId: auth.currentUser.id, companyId, memberUserId: userId, via: "Sistem yönetimi" },
      () =>
        prisma.userCompany.delete({
          where: { userId_companyId: { userId, companyId } },
        })
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Remove user-company error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
