import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const companyId = new URL(request.url).searchParams.get("companyId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  const members = await prisma.userCompany.findMany({
    where: { companyId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(members)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const { companyId, email, role } = body
  if (!companyId || !email || !role) {
    return NextResponse.json({ error: "companyId, email and role are required" }, { status: 400 })
  }
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can invite" }, { status: 403 })

  const targetUser = await prisma.user.findUnique({ where: { email } })
  if (!targetUser) {
    return NextResponse.json({ error: "User not found. Kayıtlı kullanıcı e-postası girin." }, { status: 404 })
  }

  const member = await prisma.userCompany.upsert({
    where: { userId_companyId: { userId: targetUser.id, companyId } },
    update: { role, invitedBy: user.id, invitedAt: new Date() },
    create: { userId: targetUser.id, companyId, role, invitedBy: user.id, invitedAt: new Date() },
  })
  return NextResponse.json(member, { status: 201 })
}
