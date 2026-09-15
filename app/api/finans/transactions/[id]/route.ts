import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { isCheckSettlement } from "@/lib/finans/nakit-hareket"

export const dynamic = "force-dynamic"

/** Tek bir işlemin (tahsilat/ödeme/gelir/gider) detayını döner. */
export const GET = withApiErrors(async function GET(
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
})

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
export const DELETE = withApiErrors(async function DELETE(
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
    // Çek/senet tahsil hareketi: sahibi çek/senet kaydıdır (durumu geri alınca
    // kendiliğinden silinir). Buradan silinirse çek "tahsil edildi" kalır, para yok olur.
    if (isCheckSettlement(transaction)) {
      return NextResponse.json(
        {
          error:
            "Bu hareket bir çek/senet tahsilinden doğdu. Silmek için Çek & Senet ekranından kaydın durumunu değiştirin.",
          code: "TRANSACTION_LINKED_TO_CHECK",
        },
        { status: 409 },
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
      // Bakiye geri alma ATOMİK (`increment`/`decrement`): oku-topla-yaz eşzamanlı
      // işlemde kaybettiriyordu (bkz. POST). TRANSFER buraya gelmez (yukarıda kesildi).
      const amount = Number(transaction.amount)
      if (transaction.type === "INCOME" || transaction.type === "EXPENSE") {
        await db.financialAccount.updateMany({
          where: { id: transaction.accountId },
          data: {
            balance:
              transaction.type === "INCOME" ? { decrement: amount } : { increment: amount },
          },
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
})
