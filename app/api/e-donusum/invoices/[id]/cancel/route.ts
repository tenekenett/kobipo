import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

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
        createdAt: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    if (!invoice.uuid) {
      return NextResponse.json(
        { error: "Fatura Mysoft'a gönderilmemiş (UUID yok)" },
        { status: 400 }
      )
    }

    if (invoice.invoiceType !== "E_ARCHIVE") {
      return NextResponse.json(
        { error: "Sadece e-Arşiv faturalar bu yöntemle iptal edilebilir. e-Fatura için iade faturası kesilmesi gerekir." },
        { status: 400 }
      )
    }

    if (invoice.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Fatura zaten iptal edilmiş." },
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
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
      },
    })

    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Mysoft API bilgileri eksik. E-Dönüşüm ayarlarını kontrol edin." },
        { status: 400 }
      )
    }

    assertEInvoiceRuntimeReady()
    const plainPassword = decryptSecret(company.eDonusumApiPassword)
    const provider = createEInvoiceProvider({
      providerName: "mysoft",
      username: company.eDonusumApiUsername,
      passwordText: plainPassword,
      apiUrl: company.eDonusumApiUrl || undefined,
    })

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

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "CANCELLED",
        integrationStatus: "CANCELLED:IPTAL_EDILDI",
      },
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
