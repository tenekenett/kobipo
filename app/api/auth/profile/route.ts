import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, email: true, phone: true, twoFactorEnabled: true },
  })
  return NextResponse.json(profile)
}

export async function PUT(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const { name, email, phone, password, twoFactorEnabled } = body
  if (email && email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing && existing.id !== user.id) {
      return NextResponse.json({ error: "Bu e-posta başka bir kullanıcıda kayıtlı" }, { status: 409 })
    }
  }

  const data: any = {
    name,
    email,
    phone,
    twoFactorEnabled: Boolean(twoFactorEnabled),
  }
  if (password) {
    data.password = await bcrypt.hash(password, 10)
    data.twoFactorSecret = data.twoFactorEnabled ? `2FA-${Date.now()}` : null
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: { id: true, name: true, email: true, phone: true, twoFactorEnabled: true },
  })
  return NextResponse.json(updated)
}
