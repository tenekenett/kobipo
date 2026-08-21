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
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * GİB onaylı resmî PDF'i Mysoft'tan indirir.
 * Bu, lib/pdf/documents/fatura-document.ts'in ürettiği iç görünümden farklıdır —
 * yasal geçerliliği olan ve GİB UBL'sinden üretilmiş resmî dökümandır.
 */
export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: rawId } = await params
    const url = new URL(request.url)
    // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
    const scopeCompanyId = await resolveCompanyId(
      url.searchParams.get("companyId") || url.searchParams.get("company"),
    )
    const id = await resolveSlugId("invoice", rawId, scopeCompanyId)
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        uuid: true,
        invoiceNo: true,
        invoiceType: true,
        status: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    }

    await ensureCompanyExport(invoice.companyId)

    // Resmî PDF yalnızca kesinleşmiş (GİB'e gönderilmiş) faturada olur. GİB taslağında
    // uuid dolu olsa da resmî belge yoktur — taslak PDF için ../draft-pdf kullanılır.
    if (invoice.status !== "SENT" || !invoice.uuid) {
      return NextResponse.json(
        { error: "Fatura henüz GİB'e gönderilmemiş (resmî PDF yok)." },
        { status: 400 }
      )
    }

    if (invoice.invoiceType !== "E_ARCHIVE" && invoice.invoiceType !== "E_INVOICE") {
      return NextResponse.json(
        { error: "Sadece e-Fatura / e-Arşiv için resmî PDF indirilebilir." },
        { status: 400 }
      )
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
    const provider = resolved.provider

    if (!provider.getInvoicePdf) {
      return NextResponse.json(
        { error: "Bu sağlayıcı PDF indirmeyi desteklemiyor." },
        { status: 400 }
      )
    }

    const result = await provider.getInvoicePdf(invoice.uuid)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }

    // GİB zip'inden gelen resmî belge adını kullan; yoksa iç fatura numarasına düş.
    const rawName = result.filename?.trim() || `${invoice.invoiceNo}.pdf`
    const filename = rawName.toLowerCase().endsWith(".pdf") ? rawName : `${rawName}.pdf`
    return new NextResponse(new Uint8Array(result.pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(result.pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching GIB PDF:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
})
