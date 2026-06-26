import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

// Signup/davet ile aynı şifre politikası.
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

const resetSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .regex(
      PASSWORD_REGEX,
      "Şifre en az 8 karakter olmalı; bir büyük harf, bir rakam ve bir özel karakter içermelidir"
    ),
})

/** Token geçerli mi (var, kullanılmamış, süresi dolmamış)? */
async function findValidToken(token: string) {
  if (!token) return null
  const record = await prisma.passwordResetToken.findUnique({
    where: { token },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  })
  if (!record || record.usedAt || record.expiresAt < new Date()) return null
  return record
}

/** GET ?token=... → sayfanın formu göstermeden önce token'ı doğrulaması için. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? ""
  const record = await findValidToken(token)
  return NextResponse.json({ valid: Boolean(record) })
}

/** POST { token, password } → yeni şifreyi belirler ve token'ı tek kullanımlık tüketir. */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 })
  }

  const parsed = resetSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Geçersiz veri"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { token, password } = parsed.data
  const record = await findValidToken(token)
  if (!record) {
    return NextResponse.json(
      { error: "Bağlantı geçersiz veya süresi dolmuş. Lütfen yeniden talep edin." },
      { status: 400 }
    )
  }

  const hashedPassword = await bcrypt.hash(password, 10)

  // Şifreyi güncelle ve token'ı tek kullanımlık olarak işaretle.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Aynı kullanıcının kalan diğer açık token'larını da geçersiz kıl.
    prisma.passwordResetToken.deleteMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
    }),
  ])

  await prisma.systemLog
    .create({
      data: {
        userId: record.userId,
        action: "PASSWORD_RESET",
        entity: "User",
        entityId: record.userId,
        details: "Kullanıcı şifresini self-servis sıfırlama ile değiştirdi",
        level: "INFO",
      },
    })
    .catch(() => {})

  return NextResponse.json({ ok: true, message: "Şifreniz güncellendi." })
}
