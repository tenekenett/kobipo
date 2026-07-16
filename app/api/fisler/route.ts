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

    const receipts = await prisma.invoice.findMany({
      where: {
        companyId,
        isReceipt: true,
        type,
        status: { notIn: ["CANCELLED", "CONVERTED"] },
      },
      include: {
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
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
