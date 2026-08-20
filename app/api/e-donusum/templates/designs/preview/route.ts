import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"
import { readSampleTemplate } from "@/lib/integrations/e-invoice/sample-templates"
import {
  applyThemeToXslt,
  normalizeDesignOptions,
  sampleKeyForDocType,
} from "@/lib/integrations/e-invoice/template-designer"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Kayıtlı bir Kobipo tasarımının (xsltName) PDF önizlemesini döndürür. Tasarım
 * seçenekleri DB'den okunur, taban şablona uygulanır ve Mysoft getXsltPreviewPdf
 * ile PDF üretilir. (Mysoft kayıtlı XSLT içeriğini geri vermediği için bu yol gerekir.)
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body.companyId)
    const { xsltName } = body
    const eDocumentType = Number(body.eDocumentType)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (eDocumentType !== 1 && eDocumentType !== 2) {
      return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
    }
    if (typeof xsltName !== "string" || !xsltName.trim()) {
      return NextResponse.json({ error: "Şablon adı zorunlu." }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)
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
        taxNumber: true,
        eDonusumTenantVkn: true,
        parentCompany: { select: { taxNumber: true } },
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json({ error: "Mysoft API bilgileri eksik." }, { status: 400 })
    }
    // Mükellef VKN doğrudan firmanın VKN'sinden çekilir; boşsa provider JWT'den keşfeder.
    const vkn = effectiveTenantVkn(company)
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
      return accessDeniedResponse(error)
    }
    console.error("templates designs preview error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
