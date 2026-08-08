import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"
import { readSampleTemplate } from "@/lib/integrations/e-invoice/sample-templates"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Yüklenecek XSLT'nin PDF önizlemesini döndürür (kaydetmeden).
 * Swagger v8: POST /api/Tenant/getXsltPreviewPdf
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    body.companyId = await resolveCompanyId(body.companyId)
    const { companyId, sampleKey, isInternetSales } = body
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    // Kaynak: gömülü örnek (sampleKey) ya da kullanıcının yüklediği XSLT (content).
    let docType: number
    let content: string
    let fileName: string | undefined

    if (typeof sampleKey === "string" && sampleKey.trim()) {
      const sample = await readSampleTemplate(sampleKey.trim())
      if (!sample.meta) return NextResponse.json({ error: "Örnek şablon bulunamadı." }, { status: 404 })
      if (!sample.available) {
        return NextResponse.json(
          { error: "Bu örnek şablon henüz hazır değil (içerik yüklenmemiş)." },
          { status: 409 },
        )
      }
      docType = sample.meta.eDocumentType
      content = sample.content
      fileName = sample.meta.fileName
    } else {
      docType = Number(body.eDocumentType)
      if (!Number.isInteger(docType) || docType < 1) {
        return NextResponse.json({ error: "Geçerli bir belge tipi seçin." }, { status: 400 })
      }
      if (typeof body.content !== "string" || !body.content.trim()) {
        return NextResponse.json({ error: "XSLT dosyası boş." }, { status: 400 })
      }
      content = body.content
      fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : undefined
    }

    await ensureCompanyWrite(companyId)
    assertEInvoiceRuntimeReady()

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
    // Mükellef VKN doğrudan firmanın VKN'sinden çekilir (doğrulama adımı yok);
    // boşsa provider JWT'den keşfeder.
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

    const result = await provider.getXsltPreviewPdf({
      eDocumentType: docType,
      content,
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.trim() : undefined,
      isInternetSales: typeof isInternetSales === "boolean" ? isInternetSales : undefined,
    })
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
    console.error("templates preview error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
