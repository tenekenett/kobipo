import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse } from "@/lib/api/errors"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { resolveCompanyEInvoiceProvider } from "@/lib/integrations/e-invoice/company-provider"
import { COMPANY_PROVIDER_SELECT } from "@/lib/integrations/e-invoice/company-provider"
import {
  readSampleTemplate,
  sampleVersionForDocType,
} from "@/lib/integrations/e-invoice/sample-templates"
import {
  applyThemeToXslt,
  normalizeDesignOptions,
  sampleKeyForDocType,
} from "@/lib/integrations/e-invoice/template-designer"

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
export async function POST(request: Request) {
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

    const row = await prisma.eInvoiceTemplate.findUnique({
      where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName } },
      select: { options: true, baseVersion: true },
    })
    if (!row) return NextResponse.json({ error: "Şablon bulunamadı." }, { status: 404 })
    if (row.options == null) {
      return NextResponse.json(
        {
          error:
            "Bu şablon dışarıdan yüklenmiş; içeriği Kobipo'da saklanmıyor, yenilenemez. Mysoft portalinden güncelleyin.",
        },
        { status: 409 },
      )
    }

    const sampleKey = sampleKeyForDocType(eDocumentType)
    if (!sampleKey) {
      return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
    }
    const sample = await readSampleTemplate(sampleKey)
    if (!sample.available || !sample.content) {
      return NextResponse.json({ error: "Taban şablon bulunamadı." }, { status: 409 })
    }

    const content = applyThemeToXslt(sample.content, normalizeDesignOptions(row.options))

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_PROVIDER_SELECT,
    })
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }

    const result = await resolved.provider.addTenantXslt({
      xsltName,
      eDocumentType,
      content,
      fileName: `${xsltName}.xslt`,
    })
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Şablon Mysoft'a yüklenemedi." },
        { status: 502 },
      )
    }

    // Yenileme kaydı: bir dahaki taban değişikliğinde kimin bayat olduğu buradan bilinir.
    const baseVersion = await sampleVersionForDocType(eDocumentType)
    await prisma.eInvoiceTemplate.update({
      where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName } },
      data: { baseVersion, refreshedAt: new Date(), hidden: false },
    })

    return NextResponse.json({ success: true, xsltName, baseVersion })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates refresh error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
