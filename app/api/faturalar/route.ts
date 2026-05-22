import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

/**
 * Birleşik fatura listesi — gelen + giden.
 *
 * Kaynaklar:
 *  - Gelen  : IncomingInvoice (Mysoft InvoiceInbox'tan çekilen e-faturalar)
 *           + Invoice (type=PURCHASE) (manuel girilen alış faturaları)
 *  - Giden  : Invoice (type=SALES) (manuel + e-fatura olarak gönderilenler)
 *
 * Query params:
 *  - companyId   (zorunlu)
 *  - direction   ("all" default | "incoming" | "outgoing")
 *  - days        (default 90) — son N gün; startDate verilirse görmezden gelinir
 *  - startDate   ISO
 *  - endDate     ISO
 *  - status      filtre (KABUL/RED/DRAFT/SENT/...)
 *  - search      fatura no / karşı taraf adı / VKN / ETTN
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = url.searchParams.get("companyId")
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const direction = (url.searchParams.get("direction") || "all") as
      | "all"
      | "incoming"
      | "outgoing"
    const includeInboxParam = url.searchParams.get("includeInbox")
    const includeInbox = includeInboxParam === null ? true : includeInboxParam !== "false"
    const days = Number(url.searchParams.get("days") || "90")
    const endParam = url.searchParams.get("endDate")
    const startParam = url.searchParams.get("startDate")
    const status = url.searchParams.get("status") || undefined
    const search = (url.searchParams.get("search") || "").trim()

    const end = endParam ? new Date(endParam) : new Date()
    const start = startParam
      ? new Date(startParam)
      : new Date(end.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000)

    type Row = {
      id: string
      direction: "incoming" | "outgoing"
      source: "mysoft_inbox" | "manual_purchase" | "manual_sales" | "converted_inbox"
      date: string | null
      invoiceNo: string | null
      uuid: string | null
      counterparty: { name: string | null; taxNumber: string | null }
      currency: string | null
      netAmount: number | null
      vatAmount: number | null
      totalAmount: number | null
      status: string | null
      profile: string | null
      invoiceType: string | null
      meta: Record<string, any>
    }

    const out: Row[] = []

    // 1) Gelen — Mysoft InvoiceInbox (yalnızca includeInbox=true ise)
    if (direction !== "outgoing" && includeInbox) {
      const incoming = await prisma.incomingInvoice.findMany({
        where: {
          companyId,
          docDate: { gte: start, lte: end },
          ...(status ? { status } : {}),
          ...(search
            ? {
                OR: [
                  { invoiceNo: { contains: search, mode: "insensitive" } },
                  { senderName: { contains: search, mode: "insensitive" } },
                  { senderTaxNumber: { contains: search } },
                  { uuid: { contains: search } },
                ],
              }
            : {}),
        },
        orderBy: { docDate: "desc" },
        take: 500,
      })
      for (const r of incoming) {
        out.push({
          id: `incoming:${r.id}`,
          direction: "incoming",
          source: "mysoft_inbox",
          date: r.docDate ? r.docDate.toISOString() : null,
          invoiceNo: r.invoiceNo,
          uuid: r.uuid,
          counterparty: { name: r.senderName, taxNumber: r.senderTaxNumber },
          currency: r.currencyCode,
          netAmount: r.taxExclusiveAmount ? Number(r.taxExclusiveAmount) : null,
          vatAmount: r.vatAmount ? Number(r.vatAmount) : null,
          totalAmount: r.payableAmount ? Number(r.payableAmount) : null,
          status: r.status,
          profile: r.profile,
          invoiceType: r.invoiceType,
          meta: {
            envelopeStatusCode: r.envelopeStatusCode,
            envelopeStatusDesc: r.envelopeStatusDesc,
            isArchived: r.isArchived,
            isLinkedToPurchase: r.isLinkedToPurchase,
            linkedInvoiceId: r.linkedInvoiceId,
            syncedAt: r.syncedAt.toISOString(),
          },
        })
      }
    }

    // 2) Manuel + içe aktarılmış alış — Invoice (type=PURCHASE)
    if (direction !== "outgoing") {
      const manualPurchases = await prisma.invoice.findMany({
        where: {
          companyId,
          type: "PURCHASE",
          date: { gte: start, lte: end },
          ...(status ? { status } : {}),
          ...(search
            ? {
                OR: [
                  { invoiceNo: { contains: search, mode: "insensitive" } },
                  { supplier: { is: { name: { contains: search, mode: "insensitive" } } } },
                  { supplier: { is: { taxNumber: { contains: search } } } },
                  { uuid: { contains: search } },
                ],
              }
            : {}),
        },
        include: { supplier: { select: { name: true, taxNumber: true } } },
        orderBy: { date: "desc" },
        take: 500,
      })

      // Hangi alış faturasının gelen e-faturadan dönüştürüldüğünü tespit et
      const purchaseIds = manualPurchases.map((p) => p.id)
      const linkedInbox =
        purchaseIds.length > 0
          ? await prisma.incomingInvoice.findMany({
              where: {
                companyId,
                linkedInvoiceId: { in: purchaseIds },
              },
              select: {
                linkedInvoiceId: true,
                uuid: true,
                profile: true,
                envelopeStatusCode: true,
                envelopeStatusDesc: true,
                syncedAt: true,
              },
            })
          : []
      const inboxByInvoiceId = new Map(
        linkedInbox
          .filter((x) => x.linkedInvoiceId)
          .map((x) => [x.linkedInvoiceId as string, x]),
      )

      for (const r of manualPurchases) {
        const inbox = inboxByInvoiceId.get(r.id)
        const convertedFromInbox = Boolean(inbox)
        out.push({
          id: `invoice:${r.id}`,
          direction: "incoming",
          source: convertedFromInbox ? "converted_inbox" : "manual_purchase",
          date: r.date.toISOString(),
          invoiceNo: r.invoiceNo,
          uuid: r.uuid,
          counterparty: {
            name: r.supplier?.name ?? null,
            taxNumber: r.supplier?.taxNumber ?? null,
          },
          currency: r.currency,
          netAmount: Number(r.netAmount),
          vatAmount: Number(r.vatAmount),
          totalAmount: Number(r.totalAmount),
          status: r.status,
          profile: inbox?.profile ?? null,
          invoiceType: r.invoiceType,
          meta: {
            integrationStatus: r.integrationStatus,
            integrationId: r.integrationId,
            convertedFromInbox,
            inboxUuid: inbox?.uuid ?? null,
            envelopeStatusCode: inbox?.envelopeStatusCode ?? null,
            envelopeStatusDesc: inbox?.envelopeStatusDesc ?? null,
            syncedAt: inbox?.syncedAt ? inbox.syncedAt.toISOString() : null,
          },
        })
      }
    }

    // 3) Giden — Invoice (type=SALES) — hem manuel hem Mysoft'a gönderilmiş
    if (direction !== "incoming") {
      const sales = await prisma.invoice.findMany({
        where: {
          companyId,
          type: "SALES",
          date: { gte: start, lte: end },
          ...(status ? { status } : {}),
          ...(search
            ? {
                OR: [
                  { invoiceNo: { contains: search, mode: "insensitive" } },
                  { customer: { is: { name: { contains: search, mode: "insensitive" } } } },
                  { customer: { is: { taxNumber: { contains: search } } } },
                  { uuid: { contains: search } },
                ],
              }
            : {}),
        },
        include: { customer: { select: { name: true, taxNumber: true } } },
        orderBy: { date: "desc" },
        take: 500,
      })
      for (const r of sales) {
        out.push({
          id: `invoice:${r.id}`,
          direction: "outgoing",
          source: "manual_sales",
          date: r.date.toISOString(),
          invoiceNo: r.invoiceNo,
          uuid: r.uuid,
          counterparty: {
            name: r.customer?.name ?? null,
            taxNumber: r.customer?.taxNumber ?? null,
          },
          currency: r.currency,
          netAmount: Number(r.netAmount),
          vatAmount: Number(r.vatAmount),
          totalAmount: Number(r.totalAmount),
          status: r.status,
          profile: null,
          invoiceType: r.invoiceType,
          meta: {
            integrationStatus: r.integrationStatus,
            integrationId: r.integrationId,
          },
        })
      }
    }

    // Tarih azalan
    out.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0
      const db = b.date ? new Date(b.date).getTime() : 0
      return db - da
    })

    // Toplam metrikler
    const totals = {
      all: { count: out.length, sum: 0 },
      incoming: { count: 0, sum: 0 },
      outgoing: { count: 0, sum: 0 },
    }
    for (const r of out) {
      const amt = r.totalAmount || 0
      totals.all.sum += amt
      totals[r.direction].count += 1
      totals[r.direction].sum += amt
    }

    return NextResponse.json({
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
      totals,
      count: out.length,
      data: out,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("faturalar route error:", error)
    return NextResponse.json(
      { error: message || "Faturalar listesi alınırken hata oluştu." },
      { status: 500 },
    )
  }
}
