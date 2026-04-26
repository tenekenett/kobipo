import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import bcrypt from "bcryptjs"

export const dynamic = 'force-dynamic'

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, password, companyOrPersonName, phone } = body
    const trimmedName = String(name || "").trim()
    const normalizedEmail = String(email || "").trim().toLowerCase()
    const trimmedCompanyOrPersonName = String(companyOrPersonName || "").trim()
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
        phone: trimmedPhone,
      },
    })

    return NextResponse.json(
      { message: "Kullanıcı başarıyla oluşturuldu", userId: user.id },
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

