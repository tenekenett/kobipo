import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { logoDocTypeFor } from "@/lib/company/logo"
import { loadDocumentLogo } from "@/lib/company/logo.server"
import { renderFaturaPdf } from "@/lib/pdf/documents/fatura-document"
import { FATURA_PDF_INCLUDE, faturaPdfData } from "@/lib/pdf/documents/fatura-data"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { documentFileName, inlineDisposition, withNavigationErrorPage } from "@/lib/api/pdf-response"

export const dynamic = "force-dynamic"

/**
 * KAYDEDİLMİŞ bir faturanın RESMÎ OLMAYAN PDF'i (Kobipo düzeni, teklif gibi).
 *
 * Fatura önizleme sayfasındaki "PDF İndir" ve "Yazdır" bunu çağırır — GİB'e gitmemiş
 * belgede (Manuel/kâğıt fatura, gönderilmemiş e-belge, alış) tek çıktı budur. Belge
 * `lib/pdf/documents/fatura-document.ts`, veri `fatura-data.ts` (e-Dönüşüm detayındaki
 * `/api/faturalar/[id]/pdf` ile aynı). 2026-10-08'e kadar burası GİB düzenini taklit
 * ediyordu (e-ARŞİV FATURA kutusu, ETTN, KDV Matrahı, Ödenecek Tutar).
 *
 * Resmî GİB PDF'i (ETTN alındıktan sonra) ayrı uçtur — `[id]/pdf/route.ts`. Editördeki
 * "Önizle (GİB)" GİB düzenini korur: `POST /api/e-donusum/invoices/preview-pdf`.
 */
export const GET = withNavigationErrorPage(withApiErrors(async function GET(
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
      include: FATURA_PDF_INCLUDE,
    })
    if (!invoice) return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })

    await ensureCompanyExport(invoice.companyId)
    if (queryCompanyId && queryCompanyId !== invoice.companyId) {
      return NextResponse.json(
        { error: "Bu fatura seçili firmaya ait değil.", code: "COMPANY_MISMATCH" },
        { status: 400 },
      )
    }

    const logo = await loadDocumentLogo(invoice.companyId, logoDocTypeFor(invoice.invoiceType))
    const pdfBuffer = await renderFaturaPdf(faturaPdfData(invoice, logo))

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": inlineDisposition(documentFileName(invoice.eDocumentNo || invoice.invoiceNo, "fatura")),
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating saved-invoice preview PDF:", error)
    return NextResponse.json({ error: message || "Önizleme PDF üretilemedi" }, { status: 500 })
  }
}))
