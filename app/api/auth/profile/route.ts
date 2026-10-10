import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"
import { normalizeTrPhone, TR_PHONE_ERROR } from "@/lib/text/tr-phone"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      twoFactorEnabled: true,
      // Kayıt formunda girilen firma ünvanı + şube ismi: ilk firma oluşturma formu
      // (/companies/new) bunlarla ön doldurulur, kullanıcı yeniden yazmasın.
      companyDisplayName: true,
      companyBranchName: true,
    },
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

  // Telefon standardı (lib/text/tr-phone.ts) yalnız DEĞİŞEN numaraya uygulanır: kural
  // gelmeden önce serbest metinle kaydedilmiş numara, kullanıcı ona dokunmadan adını
  // değiştirmek isterse kaydı engellememeli. Değişen numara rakam olarak saklanır.
  let nextPhone: string | null | undefined = undefined
  if (phone !== undefined) {
    const raw = String(phone ?? "").trim()
    const current = await prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } })
    if (raw === (current?.phone ?? "").trim()) {
      nextPhone = current?.phone ?? null
    } else {
      const normalized = normalizeTrPhone(raw)
      if (!normalized) return NextResponse.json({ error: TR_PHONE_ERROR }, { status: 400 })
      nextPhone = normalized
    }
  }

  const data: any = {
    name,
    email,
    phone: nextPhone,
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
