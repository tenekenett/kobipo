import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Blog editörü yetkisini aç/kapat veya şifre sıfırla. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, isSuperAdmin: true },
  })
  if (!target) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.isBlogEditor !== undefined) data.isBlogEditor = body.isBlogEditor === true

  if (body.password !== undefined) {
    const password = String(body.password)
    if (password.length < 8) {
      return NextResponse.json({ error: "Şifre en az 8 karakter olmalı" }, { status: 400 })
    }
    data.password = await bcrypt.hash(password, 10)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Güncellenecek alan yok" }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, isSuperAdmin: true, isBlogEditor: true, createdAt: true },
  })
  return NextResponse.json(user)
}

/** Blog editörü hesabını siler (süper admin hesapları bu uçtan silinemez). */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, isSuperAdmin: true, isBlogEditor: true },
  })
  if (!target) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 })
  if (target.isSuperAdmin) {
    return NextResponse.json({ error: "Süper admin hesabı buradan silinemez" }, { status: 403 })
  }
  if (!target.isBlogEditor) {
    return NextResponse.json({ error: "Bu hesap bir blog editörü değil" }, { status: 400 })
  }

  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
