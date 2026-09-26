import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
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
 * Gelen e-faturanın UBL XML'i (GİB'den gelen belgenin kendisi).
 *
 * Path: /api/e-donusum/inbox/{ettn}/ubl?companyId=...
 *
 * PDF ucundan farkı: ETTN bu firmanın gelen kutusunda KAYITLI olmalı. Sağlayıcı
 * bayi kimliğiyle çalışabiliyor ve UBL çağrısı tenant bulunamazsa parametresiz
 * denemeye düşüyor; kayıt şartı, başka bir mükellefin belgesinin ETTN'si
 * tahmin edilerek çekilmesini kapatır.
 */
export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { uuid } = await params
  if (!uuid) return NextResponse.json({ error: "uuid (ETTN) zorunlu" }, { status: 400 })

  const url = new URL(request.url)
  const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  await ensureCompanyExport(companyId)
  assertEInvoiceRuntimeReady()

  const incoming = await prisma.incomingInvoice.findUnique({
    where: { companyId_uuid: { companyId, uuid } },
    select: { invoiceNo: true },
  })
  if (!incoming) {
    return NextResponse.json({ error: "Bu ETTN firmanın gelen e-faturaları arasında yok." }, { status: 404 })
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: COMPANY_PROVIDER_SELECT,
  })
  const resolved = resolveCompanyEInvoiceProvider(company)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  const result = await resolved.provider.getIncomingInvoiceUblXml(uuid)
  if (!result.success) {
    return NextResponse.json({ error: describeMysoftError(result.error) }, { status: 502 })
  }

  const filename = `Gelen_${incoming.invoiceNo || uuid.slice(0, 8)}.xml`
  const body = Buffer.from(result.xml, "utf-8")
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
  })
})
