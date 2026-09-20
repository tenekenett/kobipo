import { NextResponse } from "next/server"
import { Decimal } from "@prisma/client/runtime/library"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { cariVisibilityWhere } from "@/lib/cari/visibility"
import { resolveCariVisibility } from "@/lib/cari/resolve-visibility"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { BAKIYE_KAPAMA_METHOD } from "@/lib/cari/bakiye-kapama"
import { odemeDagit } from "@/lib/cari/odeme-dagit"

export const dynamic = "force-dynamic"

/**
 * BAKİYE KAPAMA / İSKONTO — birden çok faturaya, tek tutarla, tek gidişte.
 *
 * Cari penceresinden "Bakiye Kapama / İskonto" yöntemiyle gelir. Kayıt
 * `InvoicePayment(paymentMethod=WRITE_OFF, accountId=null, transactionId=null)`
 * (bkz. lib/cari/bakiye-kapama.ts); kasaya hiçbir şey yazılmaz. Tutar seçilen
 * faturalara ESKİDEN YENİYE dağıtılır (lib/cari/odeme-dagit.ts) ve seçili açık
 * toplamı AŞAMAZ — kapamanın avansı olmaz, neyi sildiğini söylemeyen bir tutar
 * kalmasın.
 *
 * Tek faturalık kapama fatura ekranından `/api/faturalar/odemeler` ile de
 * yazılabilir; iki yol aynı kaydı üretir.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    const { customerId, supplierId, invoiceIds, amount, date, notes, reference } = body

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    if ((customerId && supplierId) || (!customerId && !supplierId)) {
      return NextResponse.json({ error: "customerId veya supplierId (biri) zorunlu" }, { status: 400 })
    }
    const ids: string[] = Array.isArray(invoiceIds)
      ? Array.from(new Set(invoiceIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)))
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: "Kapatılacak en az bir fatura seçin" }, { status: 400 })
    }
    if (!(Number(amount) > 0)) {
      return NextResponse.json({ error: "Tutar 0'dan büyük olmalı" }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)

    // Cari id'leri SEF URL'lerinden slug gelebilir → cuid'e çöz.
    const resolvedCustomerId = customerId ? await resolveSlugId("customer", customerId, companyId) : null
    const resolvedSupplierId = supplierId ? await resolveSlugId("supplier", supplierId, companyId) : null

    // Yetkili çalışan kısıtı: kartı göremeyen, bakiyesini de kapatamaz
    // (open-invoices ile aynı kapı).
    const visibility = await resolveCariVisibility(companyId)
    const visibleCari = resolvedCustomerId
      ? await prisma.customer.findFirst({
          where: { id: resolvedCustomerId, companyId, ...cariVisibilityWhere(visibility) },
          select: { id: true },
        })
      : await prisma.supplier.findFirst({
          where: { id: resolvedSupplierId!, companyId, ...cariVisibilityWhere(visibility) },
          select: { id: true },
        })
    if (!visibleCari) {
      return NextResponse.json({ error: "Cari bulunamadı" }, { status: 404 })
    }

    // Faturalar bu carinin, bu firmanın ve açık olmalı — open-invoices ile aynı küme.
    const invoices = await prisma.invoice.findMany({
      where: {
        id: { in: ids },
        companyId,
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        ...(resolvedCustomerId
          ? { customerId: resolvedCustomerId, type: "SALES" }
          : { supplierId: resolvedSupplierId, type: "PURCHASE" }),
      },
      select: {
        id: true,
        invoiceNo: true,
        date: true,
        totalAmount: true,
        payments: { select: { amount: true } },
      },
      orderBy: { date: "asc" },
    })
    if (invoices.length !== ids.length) {
      return NextResponse.json(
        { error: "Seçilen faturalardan biri bu cariye ait değil ya da kapatılamaz" },
        { status: 400 },
      )
    }

    // Açık tutar DECIMAL ile (kuruş toplamında float sapması — bkz. faturalar/odemeler).
    const openInvoices = invoices
      .map((inv) => {
        const paid = inv.payments.reduce((sum, p) => sum.plus(p.amount), new Decimal(0))
        return { id: inv.id, openAmount: new Decimal(inv.totalAmount).minus(paid).toNumber() }
      })
      .filter((inv) => inv.openAmount > 0.005)
    if (openInvoices.length === 0) {
      return NextResponse.json({ error: "Seçilen faturaların açık tutarı yok" }, { status: 400 })
    }

    const dagitim = odemeDagit(Number(amount), openInvoices)
    if (dagitim.remainder > 0) {
      return NextResponse.json(
        {
          error: `Tutar seçili faturaların açık toplamını (${dagitim.allocated.toFixed(2)}) aşıyor; bakiye kapama avans bırakmaz`,
        },
        { status: 400 },
      )
    }

    const paymentDate = date ? new Date(date) : new Date()
    const payments = await prisma.$transaction((db) =>
      Promise.all(
        dagitim.allocations.map((pay) =>
          db.invoicePayment.create({
            data: {
              invoiceId: pay.invoiceId,
              companyId,
              amount: new Decimal(pay.amount),
              paymentDate,
              paymentMethod: BAKIYE_KAPAMA_METHOD,
              accountId: null,
              transactionId: null,
              reference: reference || null,
              notes: notes || null,
              createdBy: user.id,
            },
            select: { id: true, invoiceId: true, amount: true },
          }),
        ),
      ),
    )

    revalidateDashboard(companyId)

    return NextResponse.json(
      { payments, allocated: dagitim.allocated, count: payments.length },
      { status: 201 },
    )
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating write-off:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
