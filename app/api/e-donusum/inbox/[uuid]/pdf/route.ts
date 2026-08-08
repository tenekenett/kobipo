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
import { describeMysoftError } from "@/lib/integrations/e-invoice/error-messages"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Gelen e-fatura için resmî PDF'i Mysoft Inbox'tan indirir.
 *
 * Query params:
 *  - companyId (zorunlu) — yetki kontrolü için
 *
 * Path: /api/e-donusum/inbox/{ettn}/pdf
 * uuid = Mysoft ETTN
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

    // Inbox kaydı var mı (yetki + invoice no için)
    const incoming = await prisma.incomingInvoice.findUnique({
      where: { companyId_uuid: { companyId, uuid } },
      select: { invoiceNo: true },
    })
    // Not: Kayıt zorunlu DEĞİL — kullanıcı henüz sync etmemiş olsa bile
    // ETTN biliyorsa Mysoft'tan direkt PDF çekebilir. Yine de yetki için
    // company'yi doğruluyoruz.

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_PROVIDER_SELECT,
    })
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const provider = resolved.provider

    const result = await provider.getIncomingInvoicePdf(uuid)
    if (!result.success) {
      return NextResponse.json({ error: describeMysoftError(result.error) }, { status: 502 })
    }

    const filename = `Gelen_${incoming?.invoiceNo || uuid.slice(0, 8)}_GIB.pdf`
    return new NextResponse(new Uint8Array(result.pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(result.pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Inbox PDF error:", error)
    return NextResponse.json(
      { error: message || "PDF alınırken hata oluştu." },
      { status: 500 },
    )
  }
}
