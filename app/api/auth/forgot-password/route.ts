import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { prisma } from "@/lib/db/prisma"
import { resolveBaseUrl } from "@/lib/utils/base-url"
import { sendEmail } from "@/lib/email/resend"
import { passwordResetEmail } from "@/lib/email/templates"

export const dynamic = "force-dynamic"

const schema = z.object({
  email: z.string().email(),
})

// Token 1 saat geçerli.
const TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * Self-servis şifre sıfırlama talebi.
 *
 * Güvenlik: e-posta numaralandırmasını (enumeration) önlemek için kullanıcı
 * bulunsa da bulunmasa da DAİMA generic başarı döner. Sıfırlama bağlantısı
 * yalnızca kayıtlı kullanıcıya e-posta ile gider.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Geçerli bir e-posta girin" }, { status: 400 })
  }

  const email = parsed.data.email.trim().toLowerCase()
  const genericResponse = NextResponse.json({
    ok: true,
    message:
      "Eğer bu e-posta ile kayıtlı bir hesap varsa, şifre sıfırlama bağlantısı gönderildi.",
  })

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  })
  if (!user) {
    return genericResponse
  }

  // Aynı kullanıcının önceki kullanılmamış token'larını geçersiz kıl.
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id, usedAt: null },
  })

  const token = randomBytes(32).toString("hex")
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  })

  const resetUrl = `${resolveBaseUrl(request)}/reset-password/${token}`
  const { subject, html } = passwordResetEmail({ resetUrl, userName: user.name })
  // Gönderim yan işlemdir; başarısız olsa da generic yanıt döneriz.
  await sendEmail({ to: email, subject, html })

  return genericResponse
}
