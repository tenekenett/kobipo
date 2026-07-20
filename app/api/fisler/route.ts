import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

/**
 * Fiş listesi (hızlı satış/alış ile kesilen gayriresmî belgeler).
 * Query:
 *  - companyId  (zorunlu)
 *  - direction  ("outgoing" = satış fişleri | "incoming" = alış fişleri)
 *  - customerId (opsiyonel) — yalnız bu müşterinin fişleri (cari detay için)
 *  - supplierId (opsiyonel) — yalnız bu tedarikçinin fişleri (cari detay için)
 *
 * Yalnızca aktif (dönüştürülmemiş/iptal edilmemiş) fişler döner; bunlar toplu
 * faturaya dönüştürülebilir. Her satırda ödenen tutar da gelir.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId") || undefined)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const direction = url.searchParams.get("direction") === "incoming" ? "incoming" : "outgoing"
    const type = direction === "incoming" ? "PURCHASE" : "SALES"

    // Cari detay sayfası tek bir cariye ait fişleri ister; verilirse ona göre süz.
    const customerId = url.searchParams.get("customerId") || undefined
    const supplierId = url.searchParams.get("supplierId") || undefined
    const cariFilter = {
      ...(customerId ? { customerId } : {}),
      ...(supplierId ? { supplierId } : {}),
    }

    // scope=active (varsayılan): işlem görebilen fişler — toplu faturaya dönüştürülebilir.
    // scope=archived: kapanmış fişler (iptal edilmiş + faturaya dönüştürülmüş); salt görüntüleme.
    // scope=all: hepsi (cari detayında dönüşmüş fişler de görünsün diye).
    const scopeParam = url.searchParams.get("scope")
    const scope = scopeParam === "archived" ? "archived" : scopeParam === "all" ? "all" : "active"
    const statusFilter =
      scope === "all"
        ? {}
        : scope === "archived"
          ? { status: { in: ["CANCELLED", "CONVERTED"] } }
          : { status: { notIn: ["CANCELLED", "CONVERTED"] } }

    const receipts = await prisma.invoice.findMany({
      where: {
        companyId,
        isReceipt: true,
        type,
        ...cariFilter,
        ...statusFilter,
      },
      include: {
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        convertedInvoice: { select: { id: true, invoiceNo: true, eDocumentNo: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
    })

    // Ödenen tutarlar: fiş bazlı toplam (kısmî/tam tahsilat).
    const ids = receipts.map((r) => r.id)
    const paidById = new Map<string, number>()
    if (ids.length > 0) {
      const grouped = await prisma.invoicePayment.groupBy({
        by: ["invoiceId"],
        where: { invoiceId: { in: ids } },
        _sum: { amount: true },
      })
      for (const g of grouped) paidById.set(g.invoiceId, Number(g._sum.amount || 0))
    }

    const rows = receipts.map((r) => {
      const total = Number(r.totalAmount)
      const paid = paidById.get(r.id) || 0
      return {
        id: r.id,
        slug: r.slug,
        direction,
        status: r.status,
        // Arşivde "hangi faturaya dönüştü" bilgisi gösterilir (resmi GİB no öncelikli).
        convertedInvoiceId: r.convertedInvoice?.id ?? null,
        convertedInvoiceNo: r.convertedInvoice
          ? r.convertedInvoice.eDocumentNo || r.convertedInvoice.invoiceNo
          : null,
        receiptNo: r.invoiceNo,
        date: r.date.toISOString(),
        createdAt: r.createdAt.toISOString(),
        counterpartyId: direction === "incoming" ? r.supplierId : r.customerId,
        counterpartyName:
          (direction === "incoming" ? r.supplier?.name : r.customer?.name) ?? null,
        currency: r.currency,
        netAmount: Number(r.netAmount),
        vatAmount: Number(r.vatAmount),
        totalAmount: total,
        paidAmount: paid,
        // Ödeme durumu: tam / kısmî / açık (veresiye).
        paymentStatus: paid <= 0 ? "OPEN" : paid + 0.01 >= total ? "PAID" : "PARTIAL",
      }
    })

    const totals = {
      count: rows.length,
      sum: rows.reduce((s, r) => s + r.totalAmount, 0),
    }

    return NextResponse.json({ rows, totals })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error listing receipts:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
