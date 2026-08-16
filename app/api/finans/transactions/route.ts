import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { accountPaymentMethod } from "@/lib/finans/account-types"
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
    const accountId = searchParams.get("accountId")
    const type = searchParams.get("type")
    const customerId = searchParams.get("customerId")
    const supplierId = searchParams.get("supplierId")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

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

    if (accountId) {
      where.accountId = accountId
    }

    if (type) {
      where.type = type
    }

    if (customerId) {
      where.customerId = customerId
    }

    if (supplierId) {
      where.supplierId = supplierId
    }

    if (startDate || endDate) {
      where.date = {}
      if (startDate) {
        where.date.gte = new Date(startDate)
      }
      if (endDate) {
        where.date.lte = new Date(endDate)
      }
    }

    const transactions = await prisma.transaction.findMany({
      where,
      select: {
        id: true,
        date: true,
        type: true,
        amount: true,
        currency: true,
        description: true,
        reference: true,
        accountId: true,
        customerId: true,
        supplierId: true,
        account: { select: { id: true, name: true, currency: true } },
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    })

    return NextResponse.json(transactions)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching transactions:", error)
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
      companyId,
      accountId,
      transferAccountId,
      type,
      amount,
      currency,
      description,
      date,
      reference,
      customerId,
      supplierId,
      invoiceId,
    } = body

    if (!companyId || !accountId || !type || !amount) {
      return NextResponse.json(
        { error: "companyId, accountId, type, and amount are required" },
        { status: 400 }
      )
    }
    // Tutar pozitif olmalı: negatif işlem hesap bakiyesini ters yönde bozardı (NaN/0 dahil red).
    if (!(Number(amount) > 0)) {
      return NextResponse.json({ error: "Tutar 0'dan büyük olmalı" }, { status: 400 })
    }
    if (type === "TRANSFER" && !transferAccountId) {
      return NextResponse.json(
        { error: "transferAccountId is required for transfer" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)

    // Cari id'leri SEF URL'lerinden slug olarak gelebilir (ör. cari detay sayfasındaki
    // "Yeni Ödeme/Tahsilat"). Gerçek cuid'e çöz; aksi halde transaction.create
    // supplierId/customerId FK ihlaliyle 500 (Internal server error) verir.
    const resolvedCustomerId = customerId
      ? await resolveSlugId("customer", customerId, companyId)
      : null
    const resolvedSupplierId = supplierId
      ? await resolveSlugId("supplier", supplierId, companyId)
      : null

    const account = await prisma.financialAccount.findUnique({
      where: { id: accountId },
    })

    if (!account || account.companyId !== companyId) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    const numericAmount = parseFloat(amount)
    const transactionDate = date ? new Date(date) : new Date()

    // Transfer hedefini işlemden önce doğrula (atomik blok içinde return edilemez).
    let targetAccount: { id: string; balance: any } | null = null
    if (type === "TRANSFER" && transferAccountId) {
      const found = await prisma.financialAccount.findUnique({
        where: { id: transferAccountId },
      })
      if (!found || found.companyId !== companyId) {
        return NextResponse.json({ error: "Transfer account not found" }, { status: 404 })
      }
      targetAccount = { id: found.id, balance: found.balance }
    }

    // Opsiyonel fatura eşleştirmesi (yalnızca INCOME/EXPENSE). Tahsilat/ödeme
    // tutarının açık fatura kadarı InvoicePayment olarak da yazılır; fazlası
    // avans olarak yalnızca işlemde (Transaction) kalır.
    let invoiceAllocation: { invoiceId: string; allocated: number } | null = null
    if (invoiceId && (type === "INCOME" || type === "EXPENSE")) {
      const inv = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: { select: { amount: true } } },
      })
      if (!inv || inv.companyId !== companyId) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
      }
      if (inv.status === "CANCELLED") {
        return NextResponse.json(
          { error: "İptal edilmiş faturaya ödeme eşleştirilemez" },
          { status: 400 },
        )
      }
      const partyOk =
        type === "INCOME"
          ? inv.type === "SALES" && (!resolvedCustomerId || inv.customerId === resolvedCustomerId)
          : inv.type === "PURCHASE" && (!resolvedSupplierId || inv.supplierId === resolvedSupplierId)
      if (!partyOk) {
        return NextResponse.json(
          { error: "Seçilen fatura bu cari veya işlem tipiyle eşleşmiyor" },
          { status: 400 },
        )
      }
      const paid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0)
      const open = Number(inv.totalAmount) - paid
      if (open <= 0) {
        return NextResponse.json(
          { error: "Seçilen faturanın açık tutarı yok" },
          { status: 400 },
        )
      }
      invoiceAllocation = { invoiceId: inv.id, allocated: Math.min(numericAmount, open) }
    }

    // Ödeme yöntemi kanalın türünden okunur: kredi kartı/POS kanalı BANK_TRANSFER
    // ("Havale / EFT") olarak yazılmamalı.
    const paymentMethod = accountPaymentMethod(account.type)

    const transaction = await prisma.$transaction(async (db) => {
      const created = await db.transaction.create({
        data: {
          companyId,
          accountId,
          type,
          amount: numericAmount,
          currency: currency || "TRY",
          description,
          date: transactionDate,
          reference: reference || (type === "TRANSFER" ? `TRANSFER:${transferAccountId}` : undefined),
          customerId: resolvedCustomerId,
          supplierId: resolvedSupplierId,
          createdBy: user.id,
        },
      })

      // Kaynak hesap bakiyesi
      let newBalance = Number(account.balance)
      if (type === "INCOME") newBalance += numericAmount
      else if (type === "EXPENSE") newBalance -= numericAmount
      else if (type === "TRANSFER") newBalance -= numericAmount
      await db.financialAccount.update({
        where: { id: accountId },
        data: { balance: newBalance },
      })

      // Transfer: hedef hesaba giriş + karşı işlem
      if (type === "TRANSFER" && targetAccount) {
        await db.financialAccount.update({
          where: { id: targetAccount.id },
          data: { balance: Number(targetAccount.balance) + numericAmount },
        })
        await db.transaction.create({
          data: {
            companyId,
            accountId: targetAccount.id,
            type: "INCOME",
            amount: numericAmount,
            currency: currency || "TRY",
            description: description || "Hesaplar arası virman (giriş)",
            date: transactionDate,
            reference: `TRANSFER:${accountId}`,
            createdBy: user.id,
          },
        })
      }

      // Faturaya bağlı ödeme (kasa bakiyesini TEKRAR güncellemez — işlem güncelledi).
      if (invoiceAllocation && invoiceAllocation.allocated > 0) {
        await db.invoicePayment.create({
          data: {
            invoiceId: invoiceAllocation.invoiceId,
            companyId,
            amount: invoiceAllocation.allocated,
            paymentDate: transactionDate,
            paymentMethod,
            accountId,
            transactionId: created.id,
            reference: reference || null,
            createdBy: user.id,
          },
        })
      }

      return created
    })

    revalidateDashboard(companyId)

    return NextResponse.json(transaction, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating transaction:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

