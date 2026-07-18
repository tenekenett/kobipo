import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import {
  generateGibInvoicePdfBuffer,
  type GibInvoiceLine,
  type GibDocKind,
} from "@/lib/pdf/gib-invoice-pdf"

export const dynamic = "force-dynamic"

/**
 * KAYDEDİLMİŞ bir faturadan GİB düzeninde taslak/ön izleme PDF'i üretir.
 *
 * Editördeki (kaydetmeden) `POST /api/e-donusum/invoices/preview-pdf` ile aynı
 * görünümü verir; fark, verinin DB'deki kayıtlı faturadan gelmesidir. Fatura
 * önizleme sayfasındaki "PDF İndir" butonu bunu çağırır. Resmî GİB PDF'i (ETTN
 * alındıktan sonra) ayrı endpoint üretir — bkz. `[id]/pdf/route.ts`.
 */

const n = (v: unknown): number => Number(v) || 0

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const queryCompanyId = await resolveCompanyId(searchParams.get("companyId"))
    const resolvedId = await resolveSlugId("invoice", (await params).id, queryCompanyId)

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedId },
      include: {
        company: {
          select: {
            name: true,
            taxNumber: true,
            taxOffice: true,
            address: true,
            city: true,
            phone: true,
            email: true,
          },
        },
        customer: true,
        supplier: true,
        items: { orderBy: { order: "asc" } },
      },
    })
    if (!invoice) return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })

    await ensureCompanyAccess(invoice.companyId)
    if (queryCompanyId && queryCompanyId !== invoice.companyId) {
      return NextResponse.json(
        { error: "Bu fatura seçili firmaya ait değil.", code: "COMPANY_MISMATCH" },
        { status: 400 },
      )
    }

    const type: "SALES" | "PURCHASE" | "RETURN" =
      invoice.type === "PURCHASE" ? "PURCHASE" : invoice.type === "RETURN" ? "RETURN" : "SALES"
    const invoiceType: GibDocKind =
      invoice.invoiceType === "E_INVOICE"
        ? "E_INVOICE"
        : invoice.invoiceType === "E_ARCHIVE"
          ? "E_ARCHIVE"
          : "MANUAL"

    const party = type === "PURCHASE" ? invoice.supplier : invoice.customer || invoice.supplier
    const counterparty = party
      ? {
          name: party.name,
          taxNumber: party.taxNumber,
          taxOffice: party.taxOffice,
          address: party.address,
          district: party.district,
          city: party.city,
          phone: party.phone,
          email: party.email,
        }
      : null

    const lines: GibInvoiceLine[] = invoice.items.map((it) => {
      const gross = n(it.quantity) * n(it.unitPrice)
      const disc = n(it.discountAmount)
      return {
        description: it.description,
        quantity: n(it.quantity),
        unit: it.unit,
        unitPrice: n(it.unitPrice),
        discountAmount: disc,
        discountRate: n(it.discountRate),
        vatRate: n(it.vatRate),
        vatAmount: n(it.vatAmount),
        withholdingRate: n(it.withholdingRate),
        lineNet: gross - disc,
      }
    })

    const grossTotal = invoice.items.reduce((s, it) => s + n(it.quantity) * n(it.unitPrice), 0)
    const lineDiscountTotal = invoice.items.reduce((s, it) => s + n(it.discountAmount), 0)
    // Kalem vergileri (tevkifat/ÖTV/diğer) DB'de fatura altı (genel) iskonto UYGULANMADAN
    // saklanır; başlık matrah/KDV ise iskonto düşülmüş haldedir. Toplamın kırılımla tutması
    // için kalem vergilerini de aynı oranda küçültürüz (Kobipo önizleme ile birebir).
    const globalDiscountAmt = n(invoice.globalDiscountAmount)
    const preGlobalNet = n(invoice.netAmount) + globalDiscountAmt
    const globalFactor = preGlobalNet > 0 ? n(invoice.netAmount) / preGlobalNet : 1
    const withholdingAmount = invoice.items.reduce((s, it) => s + n(it.withholdingAmount), 0) * globalFactor
    const exciseAmount = invoice.items.reduce((s, it) => s + n(it.exciseAmount), 0) * globalFactor
    const otherTaxAmount = invoice.items.reduce((s, it) => s + n(it.otherTaxAmount), 0) * globalFactor
    const otherTaxLabel =
      invoice.items.find((it) => n(it.otherTaxAmount) > 0 && it.otherTaxName)?.otherTaxName || null

    const pdfBuffer = await generateGibInvoicePdfBuffer({
      invoiceNo: invoice.eDocumentNo || invoice.invoiceNo,
      ettn: invoice.uuid,
      date: invoice.date.toISOString(),
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      type,
      invoiceType,
      currency: invoice.currency || "TRY",
      // Resmî GİB PDF'i ayrı endpoint üretir; buradaki her zaman ön izlemedir.
      // Henüz kesinleşmemiş (DRAFT) faturada "TASLAK" filigranı gösterilir.
      isDraft: invoice.status === "DRAFT",
      company: {
        name: invoice.company.name,
        taxNumber: invoice.company.taxNumber,
        taxOffice: invoice.company.taxOffice,
        address: invoice.company.address,
        city: invoice.company.city,
        phone: invoice.company.phone,
        email: invoice.company.email,
      },
      counterparty,
      items: lines,
      totals: {
        grossTotal,
        lineDiscountTotal,
        globalDiscount: n(invoice.globalDiscountAmount),
        netAmount: n(invoice.netAmount),
        vatAmount: n(invoice.vatAmount),
        withholdingAmount,
        exciseAmount,
        otherTaxAmount,
        otherTaxLabel,
        totalAmount: n(invoice.totalAmount),
      },
      notes: invoice.notes,
    })

    const safeNo = (invoice.eDocumentNo || invoice.invoiceNo || "taslak-fatura").replace(/[^\w.-]+/g, "-")
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeNo}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating saved-invoice preview PDF:", error)
    return NextResponse.json({ error: message || "Önizleme PDF üretilemedi" }, { status: 500 })
  }
}
