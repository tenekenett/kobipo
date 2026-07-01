import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"

export const dynamic = "force-dynamic"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Blog editörü hesaplarını listeler. */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const editors = await prisma.user.findMany({
    where: { isBlogEditor: true },
    select: { id: true, name: true, email: true, isSuperAdmin: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(editors)
}

/** Yeni blog editörü hesabı oluşturur. */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const body = await request.json().catch(() => ({}))
  const name = String(body.name ?? "").trim()
  const email = String(body.email ?? "").trim().toLowerCase()
  const password = String(body.password ?? "")

  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "Geçerli bir e-posta girin" }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Şifre en az 8 karakter olmalı" }, { status: 400 })
  }

  const dup = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (dup) {
    return NextResponse.json({ error: "Bu e-posta zaten kullanılıyor" }, { status: 409 })
  }

  const hashed = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: {
      email,
      name: name || "Blog Editörü",
      password: hashed,
      isBlogEditor: true,
      emailVerified: new Date(),
    },
    select: { id: true, name: true, email: true, isSuperAdmin: true, createdAt: true },
  })
  return NextResponse.json(user, { status: 201 })
}
