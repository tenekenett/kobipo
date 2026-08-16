import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { Decimal } from "@prisma/client/runtime/library"
import { accessDeniedResponse } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"

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
      return accessDeniedResponse(error)
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

    // Kanal (kasa/banka) verildiyse firmaya ait olmalı. Eskiden doğrulanmıyordu:
    // başka firmanın hesap id'si ödemeye YAZILIYOR, bakiye ise sessizce
    // güncellenmiyordu — ortada sahibi belirsiz bir tahsilat kalıyordu.
    const account = accountId
      ? await prisma.financialAccount.findFirst({
          where: { id: accountId, companyId },
          select: { id: true },
        })
      : null
    if (accountId && !account) {
      return NextResponse.json({ error: "Hesap bulunamadı" }, { status: 404 })
    }

    const isSales = invoice.type === "SALES"
    const paidAt = paymentDate ? new Date(paymentDate) : new Date()
    const paidAmount = new Decimal(amount)

    /**
     * Tahsilat + KASA HAREKETİ tek gidişte.
     *
     * Eskiden burada yalnız `InvoicePayment` yazılıp hesabın bakiyesi elle
     * artırılıyordu; `Transaction` (kasa hareketi) YAZILMIYORDU. Oysa panonun
     * gelir/gider/net bakiye rakamları ve nakit akışı grafiği yalnızca
     * `transactions`ı okur — POS/fiş ve adisyon tahsilatları panoya, Finans >
     * Hareketler listesine ve cari ekstreye hiç ulaşmıyordu (canlı veride tek
     * bir firmada 562 bin TL'lik tahsilat bu yüzden kasada görünmüyordu).
     *
     * Cari ekranından girilen tahsilat baştan beri ikisini birden yazıyor ve
     * `transactionId` ile bağlıyordu; okuma katmanının tamamı (cari bakiye,
     * cari liste, gelir-gider raporu) zaten "bağlı ödemeyi iki kez sayma"
     * kuralına göre yazılmış. Eksik olan tek şey bu yazma yoluydu.
     */
    const payment = await prisma.$transaction(async (db) => {
      let transactionId: string | null = null

      if (account) {
        const trx = await db.transaction.create({
          data: {
            companyId,
            accountId: account.id,
            type: isSales ? "INCOME" : "EXPENSE",
            amount: paidAmount,
            currency: invoice.currency || "TRY",
            description: `${isSales ? "Tahsilat" : "Ödeme"} — ${invoice.invoiceNo}`,
            date: paidAt,
            // Cari ekstrede faturanın borcunu KAPATAN satır budur; taraf
            // yazılmazsa fiş "ödenmemiş borç" gibi asılı kalır.
            customerId: invoice.customerId,
            supplierId: invoice.supplierId,
            reference: reference || null,
            createdBy: user.id,
          },
        })
        transactionId = trx.id

        // `increment`: oku-topla-yaz eski hâli, aynı kasaya aynı anda iki
        // tahsilat girilirse birini kaybediyordu.
        await db.financialAccount.update({
          where: { id: account.id },
          data: { balance: { increment: isSales ? paidAmount : paidAmount.negated() } },
        })
      }

      return db.invoicePayment.create({
        data: {
          invoiceId,
          companyId,
          amount: paidAmount,
          paymentDate: paidAt,
          paymentMethod,
          accountId: account?.id ?? null,
          transactionId,
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
    })

    // Pano "satış yapıldığı anda" güncellensin: 20 sn'lik önbellek düşürülür.
    revalidateDashboard(companyId)

    return NextResponse.json(payment, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating payment:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

