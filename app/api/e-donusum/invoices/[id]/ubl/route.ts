import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { describeMysoftError } from "@/lib/integrations/e-invoice/error-messages"
import { withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * GİB'e gönderilmiş e-Fatura / e-Arşiv'in UBL XML'i (giden kutusundaki belgenin kendisi).
 *
 * Path: /api/e-donusum/invoices/{id}/ubl?companyId=...
 *
 * Kural resmî PDF ucuyla (../pdf) AYNI: yalnız kesinleşmiş (SENT + ETTN) e-belge.
 * GİB taslağında ETTN dolu olsa da resmî belge yoktur.
 */
export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const url = new URL(request.url)
  // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
  const scopeCompanyId = await resolveCompanyId(
    url.searchParams.get("companyId") || url.searchParams.get("company"),
  )
  const id = await resolveSlugId("invoice", rawId, scopeCompanyId)
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, companyId: true, uuid: true, invoiceNo: true, eDocumentNo: true, invoiceType: true, status: true },
  })
  if (!invoice) return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })

  await ensureCompanyExport(invoice.companyId)

  if (invoice.status !== "SENT" || !invoice.uuid) {
    return NextResponse.json({ error: "Fatura henüz GİB'e gönderilmemiş (resmî belge yok)." }, { status: 400 })
  }
  if (invoice.invoiceType !== "E_ARCHIVE" && invoice.invoiceType !== "E_INVOICE") {
    return NextResponse.json({ error: "Yalnız e-Fatura / e-Arşiv'in XML'i indirilebilir." }, { status: 400 })
  }

  const company = await prisma.company.findUnique({
    where: { id: invoice.companyId },
    select: COMPANY_PROVIDER_SELECT,
  })
  assertEInvoiceRuntimeReady()
  const resolved = resolveCompanyEInvoiceProvider(company)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  const result = await resolved.provider.getOutgoingInvoiceUblXml(invoice.uuid)
  if (!result.success) {
    return NextResponse.json({ error: describeMysoftError(result.error) }, { status: 502 })
  }

  const filename = `${invoice.eDocumentNo || invoice.invoiceNo}.xml`.replace(/[^\w.\-]/g, "_")
  const body = Buffer.from(result.xml, "utf-8")
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
  })
})
