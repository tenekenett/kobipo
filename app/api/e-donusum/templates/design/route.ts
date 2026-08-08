import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { readSampleTemplate } from "@/lib/integrations/e-invoice/sample-templates"
import {
  applyThemeToXslt,
  normalizeDesignOptions,
  sampleKeyForDocType,
} from "@/lib/integrations/e-invoice/template-designer"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Belge Şablonu Tasarımcısı — taban örnek şablona görsel tema uygulayıp üretilen
 * XSLT içeriğini döndürür. İstemci bu `content`'i mevcut `templates/preview`
 * (PDF önizleme) ve `templates` (Mysoft'a yükleme) endpoint'lerine verir.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    // companyId dashboard'dan slug gelebilir → cuid'e çevir (aksi halde ensureCompanyAccess
    // eşleşmez ve "Access denied" döner). [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body.companyId)
    const { eDocumentType, options } = body
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    const docType = Number(eDocumentType)
    if (!Number.isInteger(docType) || docType < 1) {
      return NextResponse.json({ error: "Geçerli bir belge tipi seçin." }, { status: 400 })
    }

    const sampleKey = sampleKeyForDocType(docType)
    if (!sampleKey) {
      return NextResponse.json({ error: "Geçerli bir belge tipi seçin (1=E-Fatura, 2=E-Arşiv)." }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)

    const sample = await readSampleTemplate(sampleKey)
    if (!sample.available || !sample.content) {
      return NextResponse.json({ error: "Bu belge tipi için taban şablon bulunamadı." }, { status: 409 })
    }

    const content = applyThemeToXslt(sample.content, normalizeDesignOptions(options))
    return NextResponse.json({ content })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates design error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
