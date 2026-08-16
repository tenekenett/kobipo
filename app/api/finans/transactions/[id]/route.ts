import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"

export const dynamic = "force-dynamic"

/** Tek bir işlemin (tahsilat/ödeme/gelir/gider) detayını döner. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, type: true, bankName: true } },
        customer: { select: { id: true, name: true, taxNumber: true } },
        supplier: { select: { id: true, name: true, taxNumber: true } },
        company: {
          select: { name: true, taxNumber: true, taxOffice: true, address: true, city: true, phone: true },
        },
        invoicePayments: {
          select: {
            id: true,
            amount: true,
            invoice: { select: { id: true, invoiceNo: true, type: true, totalAmount: true } },
          },
        },
      },
    })
    if (!transaction) {
      return NextResponse.json({ error: "İşlem bulunamadı" }, { status: 404 })
    }

    await ensureCompanyAccess(transaction.companyId)

    // İşlemi oluşturan kullanıcı (Transaction.createdBy id tutar, ilişki yok).
    const createdByUser = transaction.createdBy
      ? await prisma.user.findUnique({
          where: { id: transaction.createdBy },
          select: { name: true, email: true },
        })
      : null

    return NextResponse.json({ ...transaction, createdByUser })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching transaction:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Bir tahsilat/ödeme işlemini (Transaction) siler ve yan etkilerini geri alır:
 * - Kaynak hesabın bakiyesini ters yönde düzeltir (INCOME → düş, EXPENSE → ekle).
 * - Faturaya eşleştirilmiş ödeme(ler) `InvoicePayment.transaction onDelete: Cascade`
 *   ile otomatik silinir → faturanın açık tutarı yeniden açılır.
 * - Cari bakiye/ekstre değerleri Transaction'lardan türetildiği için kendiliğinden düzelir.
 *
 * Virman (TRANSFER) ve virman karşı-bacağı buradan silinmez (iki hesap + ayna işlem
 * karmaşıktır ve cari ekstresinde görünmez).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const transaction = await prisma.transaction.findUnique({ where: { id } })
    if (!transaction) {
      return NextResponse.json({ error: "İşlem bulunamadı" }, { status: 404 })
    }

    await ensureCompanyWrite(transaction.companyId)

    if (transaction.type === "TRANSFER" || transaction.reference?.startsWith("TRANSFER:")) {
      return NextResponse.json(
        { error: "Hesaplar arası virman işlemleri buradan silinemez." },
        { status: 400 },
      )
    }

    // Bordro ödemesinden doğan EXPENSE: silinirse PayrollRecord.transactionId
    // asılı kalır ve bordro hem "Ödendi" görünür hem finansal hareket yok olur.
    // Kullanıcı önce bordrodan ödemeyi geri almalı.
    const linkedPayroll = await prisma.payrollRecord.findFirst({
      where: { transactionId: transaction.id },
      select: { id: true, periodMonth: true, periodYear: true, employee: { select: { firstName: true, lastName: true } } },
    })
    if (linkedPayroll) {
      const period = `${linkedPayroll.periodMonth}/${linkedPayroll.periodYear}`
      const who = `${linkedPayroll.employee.firstName} ${linkedPayroll.employee.lastName}`
      return NextResponse.json(
        {
          error: `Bu işlem ${who} (${period}) bordro ödemesine bağlı. Önce Personel → Maaş ekranından bordronun ödemesini geri alın, sonra silebilirsiniz.`,
          code: "TRANSACTION_LINKED_TO_PAYROLL",
        },
        { status: 409 },
      )
    }

    await prisma.$transaction(async (db) => {
      const account = await db.financialAccount.findUnique({
        where: { id: transaction.accountId },
        select: { id: true, balance: true },
      })
      if (account) {
        const amount = Number(transaction.amount)
        const newBalance =
          transaction.type === "INCOME"
            ? Number(account.balance) - amount
            : transaction.type === "EXPENSE"
              ? Number(account.balance) + amount
              : Number(account.balance)
        await db.financialAccount.update({
          where: { id: account.id },
          data: { balance: newBalance },
        })
      }
      // Bağlı InvoicePayment'lar Cascade ile silinir (fatura açık tutarı geri açılır).
      await db.transaction.delete({ where: { id: transaction.id } })
    })

    revalidateDashboard(transaction.companyId)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error deleting transaction:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
