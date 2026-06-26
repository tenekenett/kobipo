import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

// Signup ile aynı şifre politikası (yeni hesap oluşturuluyor).
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

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

  const body = await request.json()
  const name = String(body.name || "").trim()
  const phone = String(body.phone || "").trim()
  const password = String(body.password || "")

  // Davet, invitation.email'e aittir. Hedef hesap DAİMA bu e-postaya göre çözülür;
  // o an giriş yapmış oturuma göre DEĞİL. Aksi halde rol, daveti açan farklı bir
  // hesaba (ör. test sırasında admin) yanlışlıkla eklenir.
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } })

  let userId: string
  let signupToken: string | null = null

  if (existing) {
    // Bu e-postayla hesap zaten var: yalnızca üyelik eklenir, kullanıcı kendi
    // şifresiyle giriş yapar (parolayı burada doğrulamaya gerek yok; davet jetonu
    // zaten bu e-posta için yetki kanıtıdır).
    userId = existing.id
  } else {
    if (!name || !phone || !password) {
      return NextResponse.json({ error: "Ad soyad, telefon ve şifre zorunludur" }, { status: 400 })
    }
    if (!PASSWORD_REGEX.test(password)) {
      return NextResponse.json(
        { error: "Şifre en az 8 karakter olmalı, en az bir büyük harf, bir rakam ve bir özel karakter içermelidir" },
        { status: 400 }
      )
    }

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

    // Otomatik giriş için tek kullanımlık, kısa ömürlü jeton (signup ile aynı desen;
    // bu jetonla yapılan ilk girişte captcha atlanır, şifre yine doğrulanır).
    try {
      signupToken = randomBytes(32).toString("hex")
      await prisma.verificationToken.create({
        data: {
          identifier: invitation.email,
          token: signupToken,
          expires: new Date(Date.now() + 5 * 60 * 1000),
        },
      })
    } catch (tokenErr) {
      console.error("Davet otomatik-giriş jetonu oluşturulamadı:", tokenErr)
      signupToken = null
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

  return NextResponse.json({
    ok: true,
    email: invitation.email,
    created: !existing,
    signupToken,
  })
}
