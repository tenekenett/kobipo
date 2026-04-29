import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = new URL(request.url).searchParams.get("companyId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  const invitations = await prisma.companyInvitation.findMany({
    where: {
      companyId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(invitations)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { companyId, email, role } = await request.json()
  if (!companyId || !email || !role) {
    return NextResponse.json({ error: "companyId, email and role are required" }, { status: 400 })
  }

  const userCompany = await ensureCompanyAccess(companyId)
  if (userCompany.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admin can invite users" }, { status: 403 })
  }

  const normalizedEmail = String(email).trim().toLowerCase()
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existingUser) {
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: existingUser.id, companyId } },
      update: { role, invitedBy: user.id, invitedAt: new Date() },
      create: { userId: existingUser.id, companyId, role, invitedBy: user.id, invitedAt: new Date() },
    })
    return NextResponse.json({ status: "added", message: "Kullanıcı firmaya eklendi" }, { status: 201 })
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const invitation = await prisma.companyInvitation.create({
    data: {
      companyId,
      email: normalizedEmail,
      role,
      token,
      invitedBy: user.id,
      expiresAt,
    },
  })

  const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
  const inviteUrl = `${baseUrl}/invite/${token}`

  return NextResponse.json({ status: "invited", inviteUrl, invitation }, { status: 201 })
}
