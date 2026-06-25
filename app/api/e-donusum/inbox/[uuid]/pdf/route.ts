import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"

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
    const companyId = url.searchParams.get("companyId")
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
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
        taxNumber: true,
        eDonusumTenantVkn: true,
        parentCompany: { select: { taxNumber: true } },
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Mysoft API bilgileri eksik. E-Dönüşüm ayarlarını kontrol edin." },
        { status: 400 },
      )
    }

    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json(
        { error: "Kayıtlı şifre çözülemedi. Şifreyi tekrar girip kaydedin." },
        { status: 400 },
      )
    }

    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
      vknTckn: effectiveTenantVkn(company) || undefined,
    })

    const result = await provider.getIncomingInvoicePdf(uuid)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 })
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Inbox PDF error:", error)
    return NextResponse.json(
      { error: message || "PDF alınırken hata oluştu." },
      { status: 500 },
    )
  }
}
