import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { renderFaturaPdf } from "@/lib/pdf/documents/fatura-document"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Fatura PDF'i (Kobipo düzeni).
 *
 * Yerleşim `lib/pdf/documents/fatura-document.ts` içinde akış tabanlı kurulur;
 * bu uç yalnız veriyi toplar. Önceki jsPDF sürümü mutlak mm koordinatı
 * kullanıyordu: adres/şehir/telefon sarılmadan çiziliyor, müşteri kutusu 25mm
 * sabit yükseklikte ad 2 / adres 1 satıra kırpılıyordu. Regresyon testleri:
 * `lib/pdf/doc/fatura-pdf-fuzz.test.ts`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const { searchParams } = new URL(request.url)
    const template = searchParams.get("template") || "standart"
    // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. Firma scope'u
    // için company/companyId param'ı da (slug olabilir) çözülür; yoksa global slug araması
    // yapılır ve erişim aşağıdaki ensureCompanyAccess ile korunur. [[slug-resolve.ts]]
    const scopeCompanyId = await resolveCompanyId(
      searchParams.get("companyId") || searchParams.get("company"),
    )
    const invoiceId = await resolveSlugId("invoice", resolvedParams.id, scopeCompanyId)

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        supplier: true,
        items: { include: { product: true }, orderBy: { order: "asc" } },
        company: {
          select: {
            id: true,
            name: true,
            taxNumber: true,
            taxOffice: true,
            address: true,
            city: true,
            phone: true,
            email: true,
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    const grossTotal = invoice.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
      0,
    )
    const lineDiscountTotal = invoice.items.reduce(
      (sum, item) => sum + Number(item.discountAmount || 0),
      0,
    )

    const pdfBuffer = await renderFaturaPdf({
      invoiceNo: invoice.invoiceNo,
      date: invoice.date,
      dueDate: invoice.dueDate,
      type: invoice.type,
      invoiceType: invoice.invoiceType,
      currency: invoice.currency || "TRY",
      notes: invoice.notes,
      template,
      company: invoice.company,
      counterparty: invoice.type === "SALES" ? invoice.customer : invoice.supplier,
      lines: invoice.items.map((item) => ({
        description: item.description,
        note: item.note,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discountAmount: Number(item.discountAmount || 0),
        vatRate: Number(item.vatRate),
        totalAmount: Number(item.totalAmount),
      })),
      grossTotal,
      lineDiscountTotal,
      globalDiscountAmount: Number(invoice.globalDiscountAmount || 0),
      netAmount: Number(invoice.netAmount),
      vatAmount: Number(invoice.vatAmount),
      totalAmount: Number(invoice.totalAmount),
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Fatura_${invoice.invoiceNo}.pdf"`,
      },
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating PDF:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
