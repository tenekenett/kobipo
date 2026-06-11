import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { Decimal } from "@prisma/client/runtime/library"

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const payment = await prisma.invoicePayment.findUnique({
      where: { id: resolvedParams.id },
      include: {
        invoice: {
          include: {
            customer: true,
            supplier: true,
          },
        },
        account: true,
      },
    })

    if (!payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    await ensureCompanyAccess(payment.companyId)

    return NextResponse.json(payment)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching payment:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const payment = await prisma.invoicePayment.findUnique({
      where: { id: resolvedParams.id },
      include: {
        invoice: true,
        account: true,
      },
    })

    if (!payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 }
      )
    }

    await ensureCompanyAccess(payment.companyId)

    // Çift yazımlı tahsilat/ödeme (bir Transaction'a bağlı): kasa hareketi
    // ödemede değil işlemde tutulur. Bu yüzden bağlı işlemi silip onun kasa
    // etkisini geri alıyoruz; InvoicePayment FK cascade ile birlikte gider.
    if (payment.transactionId) {
      const tx = await prisma.transaction.findUnique({
        where: { id: payment.transactionId },
        include: { account: true },
      })
      await prisma.$transaction(async (db) => {
        if (tx?.account) {
          const adj =
            tx.type === "INCOME"
              ? -Number(tx.amount)
              : tx.type === "EXPENSE"
                ? Number(tx.amount)
                : 0
          await db.financialAccount.update({
            where: { id: tx.accountId },
            data: { balance: new Decimal(Number(tx.account.balance) + adj) },
          })
        }
        if (tx) {
          // İşlemin silinmesi bağlı InvoicePayment'ı da siler (onDelete: Cascade).
          await db.transaction.delete({ where: { id: tx.id } })
        } else {
          // İşlem bulunamadıysa (tutarsız durum) sadece ödemeyi sil.
          await db.invoicePayment.delete({ where: { id: resolvedParams.id } })
        }
      })
      return NextResponse.json({ success: true })
    }

    // Klasik fatura ödemesi: ödeme kasayı güncellemişti, geri al.
    if (payment.accountId && payment.account) {
      const account = payment.account
      const adjustment =
        payment.invoice.type === "SALES"
          ? -Number(payment.amount)
          : Number(payment.amount)

      const newBalance = Number(account.balance) + adjustment

      await prisma.financialAccount.update({
        where: { id: account.id },
        data: { balance: new Decimal(newBalance) },
      })
    }

    // Ödemeyi sil
    await prisma.invoicePayment.delete({
      where: { id: resolvedParams.id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error deleting payment:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

