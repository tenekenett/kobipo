import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { Decimal } from "@prisma/client/runtime/library"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const invoiceId = searchParams.get("invoiceId")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = {
      companyId,
    }

    if (invoiceId) {
      where.invoiceId = invoiceId
    }

    const payments = await prisma.invoicePayment.findMany({
      where,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
          },
        },
        account: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: {
        paymentDate: "desc",
      },
    })

    return NextResponse.json(payments)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching payments:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    body.companyId = await resolveCompanyId(body.companyId)
    const {
      invoiceId,
      companyId,
      amount,
      paymentDate,
      paymentMethod,
      accountId,
      reference,
      notes,
    } = body

    if (!invoiceId || !companyId || !amount || !paymentMethod) {
      return NextResponse.json(
        { error: "invoiceId, companyId, amount, and paymentMethod are required" },
        { status: 400 }
      )
    }
    // Tutar pozitif olmalı: negatif ödeme fatura "ödendi" durumunu ve hesap bakiyesini
    // bozardı (satır ~172 bakiyeyi ±amount günceller). NaN/0 da reddedilir.
    if (!(Number(amount) > 0)) {
      return NextResponse.json({ error: "Ödeme tutarı 0'dan büyük olmalı" }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)

    // Faturayı kontrol et
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: true,
      },
    })

    if (!invoice || invoice.companyId !== companyId) {
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      )
    }

    // Toplam ödeme tutarı ve kalan — DECIMAL ile, `Number` ile DEĞİL.
    //
    // Kuruşlar ikilik tabanda tam gösterilemiyor: hesabı tam kapatan son parça
    // float toplamada kendi tutarından büyük çıkıp reddediliyordu. Gerçek vaka
    // (ADS-2026-0012): ₺5.492,70 üçe bölündü → 3 × ₺1.830,90. İlk iki tahsilat
    // yazıldı, üçüncüsünde 1830.9 > 1830.8999999999996 oldu ve kasiyer
    // "Payment amount exceeds remaining invoice amount" gördü — fiş kesilmiş,
    // hesabın son üçte biri tahsilatsız kalmıştı.
    //
    // Yuvarlama toleransı (epsilon) da işi görürdü ama sebebi örtbas ederdi:
    // tutarlar zaten `Decimal(15,2)` saklanıyor, karşılaştırma da öyle yapılmalı.
    const totalPaid = invoice.payments.reduce(
      (sum, p) => sum.plus(p.amount),
      new Decimal(0)
    )
    const remainingAmount = new Decimal(invoice.totalAmount).minus(totalPaid)

    if (new Decimal(amount).greaterThan(remainingAmount)) {
      return NextResponse.json(
        { error: "Payment amount exceeds remaining invoice amount" },
        { status: 400 }
      )
    }

    // Ödeme kaydı oluştur
    const payment = await prisma.invoicePayment.create({
      data: {
        invoiceId,
        companyId,
        amount: new Decimal(amount),
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        paymentMethod,
        accountId: accountId || null,
        reference: reference || null,
        notes: notes || null,
        createdBy: user.id,
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
          },
        },
        account: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    })

    // Eğer hesap seçildiyse, hesap bakiyesini güncelle
    if (accountId) {
      const account = await prisma.financialAccount.findUnique({
        where: { id: accountId },
      })

      if (account && account.companyId === companyId) {
        const newBalance =
          Number(account.balance) +
          (invoice.type === "SALES" ? Number(amount) : -Number(amount))

        await prisma.financialAccount.update({
          where: { id: accountId },
          data: { balance: new Decimal(newBalance) },
        })
      }
    }

    return NextResponse.json(payment, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating payment:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

