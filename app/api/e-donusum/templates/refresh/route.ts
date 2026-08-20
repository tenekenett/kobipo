import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { resolveCompanyEInvoiceProvider } from "@/lib/integrations/e-invoice/company-provider"
import { COMPANY_PROVIDER_SELECT } from "@/lib/integrations/e-invoice/company-provider"
import { ensureTemplateFresh } from "@/lib/integrations/e-invoice/template-refresh"

export const dynamic = "force-dynamic"

/**
 * ŞABLONU YENİLE — kayıtlı tasarımı güncel taban XSLT'den yeniden üretip Mysoft'a
 * AYNI ADLA yükler.
 *
 * Neden gerekli: tasarımcıyla üretilen XSLT, repodaki taban şablonun üzerine tema
 * uygulanarak oluşur. Taban değiştiğinde (ör. kalem notu satırı eklendiğinde)
 * Mysoft'taki KAYITLI kopya eski kalır ve belgeler eski görselle basılır. Yenileme
 * saklı `options` ile aynı görseli yeniden üretir; tek fark tabana eklenenlerdir.
 *
 * Aynı ad kullanıldığı için aktif şablon seçimi ve seri (prefix) eşlemeleri bozulmaz.
 *
 * Yalnız `options` saklı şablonlar yenilenebilir: dışarıdan/portalden yüklenmiş
 * tasarımın içeriği bizde yok, üzerine yazmak kullanıcının tasarımını silerdi.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body.companyId)
    const eDocumentType = Number(body.eDocumentType)
    const xsltName = typeof body.xsltName === "string" ? body.xsltName.trim() : ""

    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (!Number.isInteger(eDocumentType) || eDocumentType < 1) {
      return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
    }
    if (!xsltName) return NextResponse.json({ error: "Şablon adı zorunlu." }, { status: 400 })

    await ensureCompanyWrite(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_PROVIDER_SELECT,
    })
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    // Ortak katman: gönderim yolundaki otomatik tazeleme ile AYNI kod.
    // Düğme `force` ile çağırır — bayat olmasa da yeniden yükler.
    const result = await ensureTemplateFresh({
      companyId,
      eDocumentType,
      xsltName,
      provider: resolved.provider,
      force: true,
    })

    if (result.reason === "not-found") {
      return NextResponse.json({ error: "Şablon bulunamadı." }, { status: 404 })
    }
    if (result.reason === "external") {
      return NextResponse.json(
        {
          error:
            "Bu şablon dışarıdan yüklenmiş; içeriği Kobipo'da saklanmıyor, yenilenemez. Mysoft portalinden güncelleyin.",
        },
        { status: 409 },
      )
    }
    if (!result.refreshed) {
      return NextResponse.json(
        { error: result.error || "Şablon yenilenemedi." },
        { status: result.reason === "upload-failed" ? 502 : 409 },
      )
    }
    const baseVersion = result.baseVersion ?? null

    return NextResponse.json({ success: true, xsltName, baseVersion })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates refresh error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
