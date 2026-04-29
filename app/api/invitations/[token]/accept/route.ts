import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const invitation = await prisma.companyInvitation.findUnique({
    where: { token },
  })

  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Davet linki geçersiz veya süresi dolmuş" }, { status: 400 })
  }

  const sessionUser = await getCurrentUser()
  const body = await request.json()
  const name = String(body.name || "").trim()
  const phone = String(body.phone || "").trim()
  const password = String(body.password || "")

  let userId = sessionUser?.id

  if (!userId) {
    if (!name || !phone || !password) {
      return NextResponse.json({ error: "Ad soyad, telefon ve şifre zorunludur" }, { status: 400 })
    }
    const existing = await prisma.user.findUnique({ where: { email: invitation.email } })
    if (existing) {
      userId = existing.id
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const newUser = await prisma.user.create({
        data: {
          email: invitation.email,
          name,
          phone,
          password: hashedPassword,
        },
      })
      userId = newUser.id
    }
  }

  await prisma.userCompany.upsert({
    where: { userId_companyId: { userId, companyId: invitation.companyId } },
    update: { role: invitation.role, invitedBy: invitation.invitedBy, invitedAt: invitation.createdAt },
    create: {
      userId,
      companyId: invitation.companyId,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
    },
  })

  await prisma.companyInvitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
