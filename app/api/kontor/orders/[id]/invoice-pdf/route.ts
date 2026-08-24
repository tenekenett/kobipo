import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  COMPANY_PROVIDER_SELECT,
  resolveCompanyEInvoiceProvider,
} from "@/lib/integrations/e-invoice/company-provider"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * ALICININ kendi faturasını indirdiği uç.
 *
 * NEDEN AYRI BİR UÇ: kontör satışının faturası SATICI firmanın (Kobipo'nun tüzel
 * kişisi) companyId'sinde durur. Alıcının o firmaya hiçbir erişimi yoktur, dolayısıyla
 * genel `/api/e-donusum/invoices/[id]/pdf` ucu — ki `ensureCompanyExport(invoice.companyId)`
 * ile faturanın firmasına yetki arar — burada DAİMA reddeder. Yetki bu uçta belgeye
 * değil SİPARİŞE bakılarak verilir: siparişin sahibi firmaya erişimi olan kullanıcı,
 * o siparişin faturasını indirebilir.
 */
export const GET = withApiErrors(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const order = await prisma.kontorOrder.findUnique({
      where: { id },
      select: { id: true, companyId: true, invoiceId: true },
    })
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })

    // Yetki: siparişi VEREN firmaya erişim. Satıcı firmaya erişim aranmaz.
    await ensureCompanyAccess(order.companyId)

    if (!order.invoiceId) {
      return NextResponse.json({ error: "Bu siparişin faturası henüz kesilmedi." }, { status: 404 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: order.invoiceId },
      select: {
        id: true,
        companyId: true,
        uuid: true,
        invoiceNo: true,
        eDocumentNo: true,
        status: true,
        invoiceType: true,
      },
    })
    if (!invoice) return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })

    if (invoice.status !== "SENT" || !invoice.uuid) {
      return NextResponse.json(
        { error: "Fatura henüz GİB'e gönderilmedi; resmî PDF oluşmadı." },
        { status: 409 },
      )
    }

    const seller = await prisma.company.findUnique({
      where: { id: invoice.companyId },
      select: COMPANY_PROVIDER_SELECT,
    })

    assertEInvoiceRuntimeReady()
    const resolved = resolveCompanyEInvoiceProvider(seller)
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

    const result = await resolved.provider.getInvoicePdf(invoice.uuid)
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 502 })

    const rawName =
      result.filename?.trim() || `${invoice.eDocumentNo || invoice.invoiceNo}.pdf`
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
    if (message.toLowerCase().includes("access denied")) return accessDeniedResponse(error)
    console.error("kontor invoice-pdf error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
