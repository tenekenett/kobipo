import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { Decimal } from "@prisma/client/runtime/library"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
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

    await ensureCompanyAccess(companyId)

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

    // Toplam ödeme tutarını hesapla
    const totalPaid = invoice.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    )
    const remainingAmount = Number(invoice.totalAmount) - totalPaid

    if (Number(amount) > remainingAmount) {
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

