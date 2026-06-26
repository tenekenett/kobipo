import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const invitation = await prisma.companyInvitation.findUnique({
    where: { token },
    include: { company: { select: { name: true } } },
  })
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json({ valid: false }, { status: 404 })
  }

  // Davet edilen e-postanın halihazırda hesabı var mı? Sayfa buna göre ya şifre
  // belirleme formu (yeni şube müdürü) ya da "giriş yap" yönlendirmesi gösterir.
  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  })

  return NextResponse.json({
    valid: true,
    email: invitation.email,
    role: invitation.role,
    companyName: invitation.company.name,
    hasAccount: Boolean(existingUser),
  })
}
