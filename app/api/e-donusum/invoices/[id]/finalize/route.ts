import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { finalizeGibDraft } from "@/lib/integrations/e-invoice/send-invoice-helper"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * GİB taslağını KESİNLEŞTİRİR (sendDraftInvoiceToGIB → GİB'e gönderir). "Resmileştir"
 * akışının 2. adımı: kullanıcı taslak PDF'ini görüp onayladıktan sonra çağrılır.
 * Geri alınamaz.
 */
export const POST = withApiErrors(async function POST(
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
    const scopeCompanyId = await resolveCompanyId(
      url.searchParams.get("companyId") || url.searchParams.get("company"),
    )
    const id = await resolveSlugId("invoice", rawId, scopeCompanyId)

    const existing = await prisma.invoice.findUnique({
      where: { id },
      select: { companyId: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    }
    await ensureCompanyWrite(existing.companyId)

    const result = await finalizeGibDraft(id)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, integrationStatus: result.integrationStatus },
        { status: result.status }
      )
    }

    const updated = await prisma.invoice.findUnique({ where: { id } })
    return NextResponse.json({ success: true, uuid: result.uuid, invoice: updated })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error finalizing GIB draft:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
})
