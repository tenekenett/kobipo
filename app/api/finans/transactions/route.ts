import { NextResponse } from "next/server"
import { faturaKuru } from "@/lib/cari/doviz"
import { hareketTuruHatasi } from "@/lib/finans/hareket-turu"
import { muhasebeyeBildir } from "@/lib/muhasebe/senkron.server"
import { parseDateParam } from "@/lib/http/query-params"
import { badRequestResponse } from "@/lib/api/errors"

import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { normalizeCategory, normalizeTags } from "@/lib/finans/siniflandirma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { accountPaymentMethod } from "@/lib/finans/account-types"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { odemeDagit } from "@/lib/cari/odeme-dagit"
import { hareketKuru } from "@/lib/finans/doviz-hareket"
import { getTcmbRates } from "@/lib/exchange/tcmb"
import { randomUUID } from "node:crypto"

export const dynamic = 'force-dynamic'


export const GET = withApiErrors(async function GET(request: Request) {
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
    const startDate = parseDateParam(searchParams.get("startDate"), "startDate")
    const endDate = parseDateParam(searchParams.get("endDate"), "endDate")

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
    const __bad = badRequestResponse(error)
    if (__bad) return __bad
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching transactions:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
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
      invoiceIds,
      category,
      tags,
      exchangeRate,
      purpose: hamTur,
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
    if (!["INCOME", "EXPENSE", "TRANSFER"].includes(String(type))) {
      return NextResponse.json({ error: "Geçersiz işlem tipi" }, { status: 400 })
    }
    if (type === "TRANSFER" && transferAccountId === accountId) {
      return NextResponse.json({ error: "Kaynak ve hedef hesap aynı olamaz" }, { status: 400 })
    }
    const transactionDate = date ? new Date(date) : new Date()

    // Transfer hedefini işlemden önce doğrula (atomik blok içinde return edilemez).
    let targetAccount: { id: string; balance: any; currency: string } | null = null
    if (type === "TRANSFER" && transferAccountId) {
      const found = await prisma.financialAccount.findUnique({
        where: { id: transferAccountId },
      })
      if (!found || found.companyId !== companyId) {
        return NextResponse.json({ error: "Transfer account not found" }, { status: 404 })
      }
      targetAccount = { id: found.id, balance: found.balance, currency: found.currency }
    }

    // Opsiyonel fatura eşleştirmesi (yalnızca INCOME/EXPENSE). Birden çok fatura
    // seçilebilir (`invoiceIds`; tek `invoiceId` eski istemciler için kalıyor).
    // Tutar faturalara ESKİDEN YENİYE dağıtılır (lib/cari/odeme-dagit.ts): her
    // biri açık tutarı kadar InvoicePayment alır, fazlası avans olarak yalnızca
    // işlemde (Transaction) kalır.
    const requestedInvoiceIds: string[] = Array.from(
      new Set(
        [
          ...(Array.isArray(invoiceIds) ? invoiceIds : []),
          ...(invoiceId ? [invoiceId] : []),
        ].filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    )
    let invoiceAllocations: Array<{ invoiceId: string; allocated: number }> = []
    if (requestedInvoiceIds.length > 0 && (type === "INCOME" || type === "EXPENSE")) {
      const found = await prisma.invoice.findMany({
        where: { id: { in: requestedInvoiceIds } },
        include: { payments: { select: { amount: true } } },
        orderBy: { date: "asc" },
      })
      if (found.length !== requestedInvoiceIds.length || found.some((inv) => inv.companyId !== companyId)) {
        return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
      }
      for (const inv of found) {
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
      }
      // Dağıtım TL'dir (hareketin tutarı kasaya giren TL): dövizli faturanın açık tutarı
      // fatura kuruyla TL'ye çevrilir, faturaya yazılan ödeme yine döviz olarak saklanır
      // (aşağıda ÷ kur). Kur farkı cari bakiyesinde görünür kalır (lib/cari/doviz.ts).
      const kurlar = new Map(found.map((inv) => [inv.id, faturaKuru(inv)]))
      const openInvoices = found
        .map((inv) => ({
          id: inv.id,
          openAmount:
            Math.round(
              (Number(inv.totalAmount) - inv.payments.reduce((sum, p) => sum + Number(p.amount), 0)) * (kurlar.get(inv.id) ?? 1) * 100,
            ) / 100,
        }))
        .filter((inv) => inv.openAmount > 0.005)
      if (openInvoices.length === 0) {
        return NextResponse.json(
          { error: "Seçilen faturaların açık tutarı yok" },
          { status: 400 },
        )
      }
      invoiceAllocations = odemeDagit(numericAmount, openInvoices).allocations.map((a) => ({
        invoiceId: a.invoiceId,
        allocated: Math.round((a.amount / (kurlar.get(a.invoiceId) ?? 1)) * 100) / 100,
      }))
    }

    // Hareketin TÜRÜ (vergi, SGK, kredi, ortak — lib/finans/hareket-turu.ts). Avans burada
    // verilmez: çalışan seçimi personel tarafındadır (maaş bilgisi finansa açılmasın).
    const purpose = typeof hamTur === "string" && hamTur.trim() ? hamTur.trim() : null
    if (purpose === "ADVANCE") {
      return NextResponse.json({ error: "Personel avansı personel kartındaki Avanslar sekmesinden verilir." }, { status: 400 })
    }
    if (type !== "TRANSFER") {
      const turHatasi = hareketTuruHatasi({
        purpose,
        tip: String(type),
        employeeId: null,
        cariBagli: Boolean(resolvedCustomerId || resolvedSupplierId),
        faturaBagli: requestedInvoiceIds.length > 0,
      })
      if (turHatasi) return NextResponse.json({ error: turHatasi }, { status: 400 })
    } else if (purpose) {
      return NextResponse.json({ error: "Virmanın türü olmaz." }, { status: 400 })
    }

    // Para birimi HESABIN para birimidir; dövizli hesapta kur zorunlu, cari/fatura bağı ve
    // farklı para birimli virman reddedilir (lib/finans/doviz-hareket.ts). İstemcinin
    // gönderdiği `currency` okunmaz: formlar hep "TRY" gönderiyordu.
    void currency
    const hesapParaBirimi = (account.currency || "TRY").toUpperCase()
    const kurIstegiVar = exchangeRate !== undefined && exchangeRate !== null && String(exchangeRate).trim() !== ""
    const tcmb =
      hesapParaBirimi !== "TRY" && !kurIstegiVar
        ? await getTcmbRates()
            .then((r) => ({ USD: r.USD, EUR: r.EUR }))
            .catch(() => null)
        : null
    const doviz = hareketKuru({
      hesapParaBirimi,
      istekKuru: exchangeRate,
      tarih: transactionDate,
      simdi: new Date(),
      tcmb,
      cariBagli: Boolean(resolvedCustomerId || resolvedSupplierId || requestedInvoiceIds.length),
      ...(type === "TRANSFER" && targetAccount ? { virmanHedefParaBirimi: targetAccount.currency } : {}),
    })
    if (!doviz.ok) return NextResponse.json({ error: doviz.hata }, { status: 400 })
    // Virmanın iki bacağı ortak kimlik taşır (muhasebe eşleştirmesi: lib/muhasebe/virman-eslestir.ts).
    const transferGroupId = type === "TRANSFER" ? randomUUID() : null

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
          currency: doviz.paraBirimi,
          exchangeRate: doviz.kur,
          transferGroupId,
          description,
          date: transactionDate,
          reference: reference || (type === "TRANSFER" ? `TRANSFER:${transferAccountId}` : undefined),
          customerId: resolvedCustomerId,
          supplierId: resolvedSupplierId,
          // Sınıflandırma — gelir-gider raporunun kategori/etiket kırılımı bunu
          // okur. Normalize edilmeden yazılırsa boş dizgi "" adlı bir kategori
          // açar ve raporda "Kategorisiz"in yanında ikinci bir boş satır olur.
          category: normalizeCategory(category),
          tags: normalizeTags(tags),
          purpose,
          createdBy: user.id,
        },
      })

      // Kaynak hesap bakiyesi — ATOMİK `increment`. Oku-topla-yaz (eski hâl) aynı
      // kasaya eşzamanlı iki işlemde birini kaybediyordu; `faturalar/odemeler`
      // aynı sebeple `increment`e geçmişti, burası eski kalmıştı.
      await db.financialAccount.update({
        where: { id: accountId },
        data: {
          balance:
            type === "INCOME" ? { increment: numericAmount } : { decrement: numericAmount },
        },
      })

      // Transfer: hedef hesaba giriş + karşı işlem
      if (type === "TRANSFER" && targetAccount) {
        await db.financialAccount.update({
          where: { id: targetAccount.id },
          data: { balance: { increment: numericAmount } },
        })
        await db.transaction.create({
          data: {
            companyId,
            accountId: targetAccount.id,
            type: "INCOME",
            amount: numericAmount,
            currency: doviz.paraBirimi,
            exchangeRate: doviz.kur,
            transferGroupId,
            description: description || "Hesaplar arası virman (giriş)",
            date: transactionDate,
            reference: `TRANSFER:${accountId}`,
            createdBy: user.id,
          },
        })
      }

      // Faturaya bağlı ödemeler (kasa bakiyesini TEKRAR güncellemez — işlem
      // güncelledi). Her fatura kendi payını alır, hepsi aynı işleme bağlıdır.
      for (const allocation of invoiceAllocations) {
        if (allocation.allocated <= 0) continue
        await db.invoicePayment.create({
          data: {
            invoiceId: allocation.invoiceId,
            companyId,
            amount: allocation.allocated,
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

    // Muhasebe: hareketin taslak fişi (virmanın giriş bacağı kaynak bacağın fişinde).
    await muhasebeyeBildir(companyId, [{ tip: "TRANSACTION", id: transaction.id }])

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
})

