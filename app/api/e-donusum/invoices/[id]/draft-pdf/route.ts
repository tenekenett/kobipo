import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { getGibDraftPdf } from "@/lib/integrations/e-invoice/send-invoice-helper"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * GİB TASLAĞININ önizleme PDF'ini (filigranlı) Mysoft'tan getirir — "Resmileştir"
 * akışında kesinleştirmeden önce kontrol içindir. Yalnızca GIB_DRAFT durumundaki
 * faturalar için (kontrol getGibDraftPdf içinde); resmî PDF ayrı endpoint'tir (../pdf).
 * Tarayıcıda gömülü gösterim için "inline" döner.
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
      select: { companyId: true, invoiceNo: true },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    }

    await ensureCompanyExport(invoice.companyId)

    const result = await getGibDraftPdf(id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const rawName = result.filename?.trim() || `${invoice.invoiceNo}-taslak.pdf`
    const filename = rawName.toLowerCase().endsWith(".pdf") ? rawName : `${rawName}.pdf`
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
    console.error("Error fetching draft PDF:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
})
