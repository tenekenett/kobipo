import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import {
  describeMysoftError,
  isMysoftDocumentMissing,
} from "@/lib/integrations/e-invoice/error-messages"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Gelen e-faturanın GERÇEK belge görüntüsünü döndürür.
 *
 * Sıra: resmî GİB PDF → olmazsa GİB HTML (XSLT görüntüsü). İkisi de yoksa hata
 * döner; bilerek "kendi taslağımız" gibi bir yedeğe DÜŞMEZ — alış faturasına
 * dönüştürme ekranında kullanıcı gelen belgenin kendisini görmeli, bizim
 * ürettiğimiz bir temsilini değil.
 *
 * Path: /api/e-donusum/inbox/{ettn}/view?companyId=...
 *
 * GÜVENLİK: HTML gönderen tarafın içeriğidir (güvenilmez). `sandbox` CSP'si ve
 * nosniff ile döneriz; istemci de sandbox'lı iframe'de göstermelidir.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { uuid } = await params
    if (!uuid) {
      return NextResponse.json({ error: "uuid (ETTN) zorunlu" }, { status: 400 })
    }

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const incoming = await prisma.incomingInvoice.findUnique({
      where: { companyId_uuid: { companyId, uuid } },
      select: { invoiceNo: true },
    })

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_PROVIDER_SELECT,
    })
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const provider = resolved.provider
    const baseName = `Gelen_${incoming?.invoiceNo || uuid.slice(0, 8)}_GIB`

    const pdf = await provider.getIncomingInvoicePdf(uuid)
    if (pdf.success) {
      return new NextResponse(new Uint8Array(pdf.pdfBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${baseName}.pdf"`,
          "Content-Length": String(pdf.pdfBuffer.length),
          "X-Kobipo-Doc-Format": "pdf",
          "Cache-Control": "no-store",
        },
      })
    }

    // PDF yoksa GİB HTML görüntüsü — hâlâ gerçek belge, sadece farklı biçim.
    const html = await provider.getIncomingInvoiceHtml(uuid)
    if (html.success) {
      return new NextResponse(html.html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${baseName}.html"`,
          // Gönderen içeriği güvenilmez: script/form/aynı-origin erişimi kapalı.
          "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
          "X-Content-Type-Options": "nosniff",
          "X-Kobipo-Doc-Format": "html",
          "Cache-Control": "no-store",
        },
      })
    }

    // İki biçim de aynı kök nedenden düştüyse tek ve anlaşılır bir mesaj ver;
    // farklı nedenlerse ikisini de göster ki gerçek sorun kaybolmasın.
    const bothMissing = isMysoftDocumentMissing(pdf.error) && isMysoftDocumentMissing(html.error)
    return NextResponse.json(
      {
        error: bothMissing
          ? describeMysoftError(pdf.error)
          : `Gelen faturanın belge görüntüsü alınamadı. PDF: ${describeMysoftError(
              pdf.error,
            )} · HTML: ${describeMysoftError(html.error)}`,
        code: bothMissing ? "DOCUMENT_MISSING_AT_PROVIDER" : "DOCUMENT_UNAVAILABLE",
      },
      { status: 502 },
    )
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Inbox view error:", error)
    return NextResponse.json(
      { error: message || "Belge görüntüsü alınırken hata oluştu." },
      { status: 500 },
    )
  }
}
