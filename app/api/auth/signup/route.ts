import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"
import { verifyRecaptcha } from "@/lib/auth/recaptcha"
import { clientInfoFromHeaders, recordAccess } from "@/lib/audit/access-log"

export const dynamic = 'force-dynamic'

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, password, companyOrPersonName, companyBranchName, phone, captchaToken } =
      body

    // Bot koruması: reCAPTCHA doğrulaması (anahtar tanımlıysa zorunlu).
    const remoteIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
    const captchaOk = await verifyRecaptcha(captchaToken, remoteIp)
    if (!captchaOk) {
      return NextResponse.json(
        { error: "Doğrulama başarısız. Lütfen 'Ben robot değilim' kutusunu tekrar işaretleyin." },
        { status: 400 }
      )
    }

    const trimmedName = String(name || "").trim()
    const normalizedEmail = String(email || "").trim().toLowerCase()
    const trimmedCompanyOrPersonName = String(companyOrPersonName || "").trim()
    // Şube ismi OPSİYONELDİR: tek şubeli kullanıcı boş bırakır. Girilirse ilk firma
    // oluşturulurken forma taşınır ve Company.branchName olur.
    const trimmedCompanyBranchName = String(companyBranchName || "").trim()
    const trimmedPhone = String(phone || "").trim()

    if (!trimmedName || !normalizedEmail || !password || !trimmedCompanyOrPersonName || !trimmedPhone) {
      return NextResponse.json(
        { error: "Ad soyad, firma/şahıs adı, telefon, e-mail ve şifre zorunludur" },
        { status: 400 }
      )
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "Geçerli bir e-mail adresi girin" },
        { status: 400 }
      )
    }

    if (!PASSWORD_REGEX.test(password)) {
      return NextResponse.json(
        { error: "Şifre en az 8 karakter olmalı, en az bir büyük harf, bir rakam ve bir özel karakter içermelidir" },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "Bu email adresi zaten kullanılıyor" },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        name: trimmedName,
        email: normalizedEmail,
        password: hashedPassword,
        companyDisplayName: trimmedCompanyOrPersonName,
        companyBranchName: trimmedCompanyBranchName || null,
        phone: trimmedPhone,
      },
    })

    // Erişim defteri: hesabın hangi IP'den açıldığı, giriş kayıtlarıyla aynı tabloda.
    await recordAccess({
      action: "SIGNUP",
      info: clientInfoFromHeaders(request.headers),
      userId: user.id,
      email: normalizedEmail,
    })

    // Kayıt sonrası otomatik giriş için tek kullanımlık, kısa ömürlü jeton.
    // Kullanıcı signup'ta captcha doğrulamasından geçtiği için, bu jetonla yapılan
    // ilk giriş captcha'yı atlar (şifre yine de doğrulanır). Jeton üretilemese bile
    // kayıt başarılı sayılır; istemci giriş ekranına düşer.
    let signupToken: string | null = null
    try {
      signupToken = randomBytes(32).toString("hex")
      await prisma.verificationToken.create({
        data: {
          identifier: normalizedEmail,
          token: signupToken,
          expires: new Date(Date.now() + 5 * 60 * 1000),
        },
      })
    } catch (tokenErr) {
      console.error("Signup auto-login token oluşturulamadı:", tokenErr)
      signupToken = null
    }

    return NextResponse.json(
      { message: "Kullanıcı başarıyla oluşturuldu", userId: user.id, signupToken },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Signup error:", error)
    return NextResponse.json(
      { error: error.message || "Bir hata oluştu. Lütfen tekrar deneyin." },
      { status: 500 }
    )
  }
}

