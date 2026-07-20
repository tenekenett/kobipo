import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { voidInvoice } from "@/lib/integrations/e-invoice/void-invoice"

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

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const cancelNote: string = typeof body?.cancelNote === "string" && body.cancelNote.trim()
      ? body.cancelNote.trim()
      : "Kullanıcı tarafından iptal edildi"

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        uuid: true,
        status: true,
        invoiceType: true,
        invoiceNo: true,
        createdAt: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    // İptal yalnızca kesinleşmiş (GİB'e gönderilmiş) belgede. GİB taslağında uuid
    // dolu olsa da belge GİB'de değil — taslak için "Taslağı Geri Al" kullanılır.
    if (invoice.status !== "SENT" || !invoice.uuid) {
      return NextResponse.json(
        { error: "Yalnızca GİB'e gönderilmiş (kesinleşmiş) faturalar iptal edilebilir." },
        { status: 400 }
      )
    }

    if (invoice.invoiceType !== "E_ARCHIVE") {
      return NextResponse.json(
        { error: "Sadece e-Arşiv faturalar bu yöntemle iptal edilebilir. e-Fatura için iade faturası kesilmesi gerekir." },
        { status: 400 }
      )
    }

    // GİB kuralı: e-Arşiv 24 saat içinde iptal edilebilir
    const hoursSinceCreated = (Date.now() - new Date(invoice.createdAt).getTime()) / (1000 * 60 * 60)
    if (hoursSinceCreated > 24) {
      return NextResponse.json(
        { error: "e-Arşiv faturalar yalnızca düzenlendikten sonraki 24 saat içinde iptal edilebilir. İade faturası kesin." },
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

    if (!provider.cancelInvoice) {
      return NextResponse.json(
        { error: "Bu sağlayıcı iptal işlemini desteklemiyor." },
        { status: 400 }
      )
    }

    const result = await provider.cancelInvoice(invoice.uuid, {
      cancelType: "PORTAL",
      cancelNote,
      cancelDate: new Date().toISOString(),
    })

    if (!result.success) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { integrationStatus: `ERROR:İptal başarısız - ${result.error || "Bilinmeyen"}` },
      })
      return NextResponse.json(
        { error: result.error || "İptal başarısız" },
        { status: 502 }
      )
    }

    // Sağlayıcı iptali başarılı: stoğu geri al ve durumu CANCELLED yap (atomik).
    // Bakiye ayrıca otomatik düzelir: cari bakiye/ekstre sorguları CANCELLED
    // faturaları (ve onlara bağlı InvoicePayment'ları) zaten hariç tutuyor.
    await prisma.$transaction(async (tx) => {
      await voidInvoice(tx, {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        invoiceNo: invoice.invoiceNo,
        integrationStatus: "CANCELLED:IPTAL_EDILDI",
        createdBy: user.id,
      })
    })

    return NextResponse.json({
      success: true,
      message: result.message || "Fatura iptal edildi",
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error cancelling invoice:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
}
