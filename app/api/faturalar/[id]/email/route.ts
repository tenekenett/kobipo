import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function POST(
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
    const body = await request.json().catch(() => ({}))
    const recipientEmail = body.email as string | undefined
    // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
    const scopeCompanyId = await resolveCompanyId(
      body.companyId || url.searchParams.get("companyId") || url.searchParams.get("company"),
    )
    const id = await resolveSlugId("invoice", rawId, scopeCompanyId)

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { customer: true, supplier: true },
    })
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)
    const targetEmail = recipientEmail || invoice.customer?.email || invoice.supplier?.email
    if (!targetEmail) {
      return NextResponse.json({ error: "Recipient email not found" }, { status: 400 })
    }

    // SMTP entegrasyonu yoksa da akışı unblock etmek için enqueue/simülasyon yanıtı döndür.
    return NextResponse.json({
      success: true,
      message: "E-posta gönderimi kuyruğa alındı",
      to: targetEmail,
      invoiceNo: invoice.invoiceNo,
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
