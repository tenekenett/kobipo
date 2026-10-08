import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { logoDocTypeFor } from "@/lib/company/logo"
import { loadDocumentLogo } from "@/lib/company/logo.server"
import { renderFaturaPdf } from "@/lib/pdf/documents/fatura-document"
import { FATURA_PDF_INCLUDE, faturaPdfData } from "@/lib/pdf/documents/fatura-data"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { documentFileName, inlineDisposition, withNavigationErrorPage } from "@/lib/api/pdf-response"

export const dynamic = "force-dynamic"

/**
 * Fatura PDF'i (Kobipo düzeni).
 *
 * Yerleşim `lib/pdf/documents/fatura-document.ts` içinde akış tabanlı kurulur;
 * bu uç yalnız veriyi toplar — fatura önizleme sayfasının ucuyla (`/api/e-donusum/
 * invoices/[id]/preview-pdf`) aynı eşleyiciden (`fatura-data.ts`), aynı belge.
 * Önceki jsPDF sürümü mutlak mm koordinatı kullanıyordu: adres/şehir/telefon
 * sarılmadan çiziliyor, müşteri kutusu 25mm sabit yükseklikte ad 2 / adres 1
 * satıra kırpılıyordu. Regresyon testleri: `lib/pdf/doc/fatura-pdf-fuzz.test.ts`.
 */
export const GET = withNavigationErrorPage(withApiErrors(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const { searchParams } = new URL(request.url)
    // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. Firma scope'u
    // için company/companyId param'ı da (slug olabilir) çözülür; yoksa global slug araması
    // yapılır ve erişim aşağıdaki ensureCompanyAccess ile korunur. [[slug-resolve.ts]]
    const scopeCompanyId = await resolveCompanyId(
      searchParams.get("companyId") || searchParams.get("company"),
    )
    const invoiceId = await resolveSlugId("invoice", resolvedParams.id, scopeCompanyId)

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: FATURA_PDF_INCLUDE,
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyExport(invoice.companyId)

    const logo = await loadDocumentLogo(invoice.companyId, logoDocTypeFor(invoice.invoiceType))
    const pdfBuffer = await renderFaturaPdf(faturaPdfData(invoice, logo))

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": inlineDisposition(documentFileName(invoice.eDocumentNo || invoice.invoiceNo, "fatura")),
      },
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating PDF:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}))
