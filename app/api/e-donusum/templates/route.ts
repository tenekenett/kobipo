import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { readSampleTemplate } from "@/lib/integrations/e-invoice/sample-templates"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Mysoft Belge Dizaynı (XSLT/şablon) endpoint'leri (Swagger v8):
 *  POST /api/Tenant/getTenantXslt  — listele
 *  POST /api/Tenant/addTenantXslt  — kullanıcının kendi şablonunu yükle
 *
 * vknTckn Mysoft tarafında zorunlu — doğrulanmış `company.eDonusumTenantVkn`
 * kullanılır. Boşsa kullanıcı önce E-Dönüşüm Ayarları'na yönlendirilir (412).
 *
 * Not: Şablon ZORUNLU değil — tanımlı değilse Mysoft genel dizaynı kullanır
 * (send payload'ındaki isSendWithGeneralXsltIfDefaultNotExists). Bu ekran yalnızca
 * kullanıcı kendi özel dizaynını yüklemek isterse gereklidir.
 */

const ERR_NO_VERIFIED_VKN =
  "Mysoft mükellef VKN'niz doğrulanmamış. E-Dönüşüm Ayarları sayfasından VKN girip 'Doğrula' butonuna basın."

async function loadCredsAndVerifiedVkn(companyId: string) {
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
  if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) return null
  // Mükellef VKN doğrudan firmanın kendi VKN'sinden çekilir (doğrulama adımı yok).
  // Boşsa provider JWT'den keşfeder; bu yüzden zorunlu gate kaldırıldı.
  const vkn = effectiveTenantVkn(company)
  let passwordText: string
  try {
    passwordText = decryptSecret(company.eDonusumApiPassword)
  } catch {
    return { invalid: "Şifre çözülemedi. E-Dönüşüm şifresini tekrar girin." as const }
  }
  return {
    username: company.eDonusumApiUsername,
    passwordText,
    baseUrl: company.eDonusumApiUrl || undefined,
    vkn,
  }
}

function providerFromCreds(creds: { username: string; passwordText: string; baseUrl?: string; vkn: string }) {
  return new MysoftEInvoiceProvider({
    username: creds.username,
    passwordText: creds.passwordText,
    baseUrl: creds.baseUrl,
    vknTckn: creds.vkn,
  })
}

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    const eDocumentTypeRaw = searchParams.get("eDocumentType")
    const eDocumentType = eDocumentTypeRaw ? Number(eDocumentTypeRaw) : undefined

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const creds = await loadCredsAndVerifiedVkn(companyId)
    if (!creds) {
      return NextResponse.json(
        { error: "Mysoft API bilgileri eksik. E-Dönüşüm Ayarları'nı kontrol edin." },
        { status: 400 },
      )
    }
    if ("invalid" in creds) return NextResponse.json({ error: creds.invalid }, { status: 400 })
    if ("needsVerifiedVkn" in creds) {
      return NextResponse.json({ error: ERR_NO_VERIFIED_VKN }, { status: 412 })
    }

    const provider = providerFromCreds(creds)
    const result = await provider.listTenantXslt(
      creds.vkn,
      Number.isInteger(eDocumentType) ? eDocumentType : undefined,
    )
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Liste alınamadı" }, { status: 502 })
    }
    return NextResponse.json({ data: result.data || [], tenantVkn: creds.vkn })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    body.companyId = await resolveCompanyId(body.companyId)
    const { companyId, sampleKey, isHasLogo, isHasStamp } = body
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    // İki kaynak: (a) gömülü örnek şablon (sampleKey) ya da (b) kullanıcının
    // yüklediği XSLT (content + xsltName + eDocumentType).
    let docType: number
    let xsltName: string
    let content: string
    let fileName: string | undefined

    if (typeof sampleKey === "string" && sampleKey.trim()) {
      const sample = await readSampleTemplate(sampleKey.trim())
      if (!sample.meta) {
        return NextResponse.json({ error: "Örnek şablon bulunamadı." }, { status: 404 })
      }
      if (!sample.available) {
        return NextResponse.json(
          { error: "Bu örnek şablon henüz hazır değil (içerik yüklenmemiş)." },
          { status: 409 },
        )
      }
      docType = sample.meta.eDocumentType
      xsltName = typeof body.xsltName === "string" && body.xsltName.trim()
        ? body.xsltName.trim()
        : sample.meta.label
      content = sample.content
      fileName = sample.meta.fileName
    } else {
      docType = Number(body.eDocumentType)
      if (!Number.isInteger(docType) || docType < 1) {
        return NextResponse.json(
          { error: "Geçerli bir belge tipi seçin (1=E-Fatura, 2=E-Arşiv)." },
          { status: 400 },
        )
      }
      if (typeof body.xsltName !== "string" || !body.xsltName.trim()) {
        return NextResponse.json({ error: "Şablon adı zorunlu." }, { status: 400 })
      }
      if (typeof body.content !== "string" || !body.content.trim()) {
        return NextResponse.json({ error: "XSLT dosyası boş." }, { status: 400 })
      }
      xsltName = body.xsltName.trim()
      content = body.content
      fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : undefined
    }

    await ensureCompanyWrite(companyId)
    assertEInvoiceRuntimeReady()

    const creds = await loadCredsAndVerifiedVkn(companyId)
    if (!creds) return NextResponse.json({ error: "Mysoft API bilgileri eksik." }, { status: 400 })
    if ("invalid" in creds) return NextResponse.json({ error: creds.invalid }, { status: 400 })
    if ("needsVerifiedVkn" in creds) {
      return NextResponse.json({ error: ERR_NO_VERIFIED_VKN }, { status: 412 })
    }

    const provider = providerFromCreds(creds)
    const result = await provider.addTenantXslt({
      xsltName: xsltName.trim(),
      eDocumentType: docType,
      content,
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.trim() : undefined,
      isHasLogo: Boolean(isHasLogo),
      isHasStamp: Boolean(isHasStamp),
      vknTckn: creds.vkn,
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Şablon eklenemedi" }, { status: 502 })
    }

    // Aynı adla daha önce gizlenmiş bir şablon yeniden eklendiyse gizliliği kaldır.
    try {
      await prisma.eInvoiceTemplate.updateMany({
        where: { companyId, eDocumentType: docType, xsltName: xsltName.trim(), hidden: true },
        data: { hidden: false },
      })
    } catch (unhideError) {
      console.error("templates POST unhide error:", unhideError)
    }

    return NextResponse.json({ success: true, message: result.message })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates POST error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})

