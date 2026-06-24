import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { readSampleTemplate } from "@/lib/integrations/e-invoice/sample-templates"
import {
  applyThemeToXslt,
  normalizeDesignOptions,
  sampleKeyForDocType,
} from "@/lib/integrations/e-invoice/template-designer"

export const dynamic = "force-dynamic"

/**
 * Kayıtlı bir Kobipo tasarımının (xsltName) PDF önizlemesini döndürür. Tasarım
 * seçenekleri DB'den okunur, taban şablona uygulanır ve Mysoft getXsltPreviewPdf
 * ile PDF üretilir. (Mysoft kayıtlı XSLT içeriğini geri vermediği için bu yol gerekir.)
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { companyId, xsltName } = body
    const eDocumentType = Number(body.eDocumentType)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (eDocumentType !== 1 && eDocumentType !== 2) {
      return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
    }
    if (typeof xsltName !== "string" || !xsltName.trim()) {
      return NextResponse.json({ error: "Şablon adı zorunlu." }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const row = await prisma.eInvoiceTemplate.findUnique({
      where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName: xsltName.trim() } },
      select: { options: true },
    })
    if (!row || row.options == null) {
      return NextResponse.json(
        { error: "Bu şablon Kobipo tasarımcısıyla yapılmadığından önizlenemez." },
        { status: 409 },
      )
    }

    const sampleKey = sampleKeyForDocType(eDocumentType)
    if (!sampleKey) return NextResponse.json({ error: "Belge tipi desteklenmiyor." }, { status: 400 })
    const sample = await readSampleTemplate(sampleKey)
    if (!sample.available || !sample.content) {
      return NextResponse.json({ error: "Taban şablon bulunamadı." }, { status: 409 })
    }
    const content = applyThemeToXslt(sample.content, normalizeDesignOptions(row.options))

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
        eDonusumTenantVkn: true,
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json({ error: "Mysoft API bilgileri eksik." }, { status: 400 })
    }
    const vkn = (company.eDonusumTenantVkn || "").replace(/\D/g, "")
    if (vkn.length !== 10 && vkn.length !== 11) {
      return NextResponse.json(
        { error: "Mysoft mükellef VKN'niz doğrulanmamış. E-Dönüşüm Ayarları'ndan doğrulayın." },
        { status: 412 },
      )
    }
    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json({ error: "Şifre çözülemedi." }, { status: 400 })
    }

    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
      vknTckn: vkn,
    })

    const result = await provider.getXsltPreviewPdf({ eDocumentType, content })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }

    return new NextResponse(new Uint8Array(result.pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="onizleme.pdf"',
        "Content-Length": String(result.pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("templates designs preview error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
