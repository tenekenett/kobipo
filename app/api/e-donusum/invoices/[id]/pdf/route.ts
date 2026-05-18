import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * GİB onaylı resmî PDF'i Mysoft'tan indirir.
 * Bu, lib/pdf/invoice-pdf.ts'in ürettiği iç görünümden farklıdır —
 * yasal geçerliliği olan ve GİB UBL'sinden üretilmiş resmî dökümandır.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        uuid: true,
        invoiceNo: true,
        invoiceType: true,
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

    if (invoice.invoiceType !== "E_ARCHIVE" && invoice.invoiceType !== "E_INVOICE") {
      return NextResponse.json(
        { error: "Sadece e-Fatura / e-Arşiv için resmî PDF indirilebilir." },
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

    const filename = `Fatura_${invoice.invoiceNo}_GIB.pdf`
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching GIB PDF:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
}
