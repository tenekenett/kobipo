import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * Mysoft Tenant Numaratör endpoint'leri (Swagger v8):
 *  GET  /api/Tenant/getDocumentNumberList?vknTckn=VKN  — listele
 *  POST /api/Tenant/addDocumentNumber                  — ekle
 *
 * vknTckn / identifierNumber Mysoft tarafında ZORUNLU. Doğrulanmış VKN
 * `company.eDonusumTenantVkn` alanından okunur — boşsa kullanıcıyı önce
 * E-Dönüşüm Ayarları'na yönlendiriyoruz.
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
      eDonusumTenantVkn: true,
    },
  })
  if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) return null
  const vkn = (company.eDonusumTenantVkn || "").replace(/\D/g, "")
  if (vkn.length !== 10 && vkn.length !== 11) {
    return { needsVerifiedVkn: true as const }
  }
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

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const creds = await loadCredsAndVerifiedVkn(companyId)
    if (!creds) {
      return NextResponse.json(
        { error: "Mysoft API bilgileri eksik. E-Dönüşüm Ayarları'nı kontrol edin." },
        { status: 400 },
      )
    }
    if ("invalid" in creds) {
      return NextResponse.json({ error: creds.invalid }, { status: 400 })
    }
    if ("needsVerifiedVkn" in creds) {
      return NextResponse.json({ error: ERR_NO_VERIFIED_VKN }, { status: 412 })
    }

    const provider = new MysoftEInvoiceProvider({
      username: creds.username,
      passwordText: creds.passwordText,
      baseUrl: creds.baseUrl,
      vknTckn: creds.vkn,
    })

    const result = await provider.listNumerators(creds.vkn)
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Liste alınamadı" }, { status: 502 })
    }
    return NextResponse.json({ data: result.data || [], tenantVkn: creds.vkn })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("numerators GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { companyId, prefix, eDocumentType, isDefault, isInternetSales, isPassive, lastNumber } =
      body
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (typeof prefix !== "string" || prefix.trim().length !== 3) {
      return NextResponse.json({ error: "Prefix tam olarak 3 karakter olmalı" }, { status: 400 })
    }
    const docType = Number(eDocumentType)
    if (!Number.isInteger(docType) || docType < 1 || docType > 11) {
      return NextResponse.json(
        { error: "eDocumentType 1-11 arasında olmalı (1=E-Fatura, 2=E-Arşiv, ...)" },
        { status: 400 },
      )
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const creds = await loadCredsAndVerifiedVkn(companyId)
    if (!creds) {
      return NextResponse.json({ error: "Mysoft API bilgileri eksik." }, { status: 400 })
    }
    if ("invalid" in creds) {
      return NextResponse.json({ error: creds.invalid }, { status: 400 })
    }
    if ("needsVerifiedVkn" in creds) {
      return NextResponse.json({ error: ERR_NO_VERIFIED_VKN }, { status: 412 })
    }

    const provider = new MysoftEInvoiceProvider({
      username: creds.username,
      passwordText: creds.passwordText,
      baseUrl: creds.baseUrl,
      vknTckn: creds.vkn,
    })

    const cleanPrefix = prefix.trim().toUpperCase()
    const result = await provider.addNumerator({
      prefix: cleanPrefix,
      eDocumentType: docType,
      isDefault: Boolean(isDefault),
      isInternetSales: Boolean(isInternetSales),
      isPassive: Boolean(isPassive),
      lastNumber: typeof lastNumber === "number" && Number.isFinite(lastNumber) ? lastNumber : 0,
      identifierNumber: creds.vkn,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Numaratör eklenemedi" }, { status: 502 })
    }

    // Kobipo'da default prefix'i de güncelle (E-Fatura/E-Arşiv için)
    if (docType === 1) {
      await prisma.company.update({
        where: { id: companyId },
        data: { eFaturaPrefix: cleanPrefix },
      })
    } else if (docType === 2) {
      await prisma.company.update({
        where: { id: companyId },
        data: { eArchivePrefix: cleanPrefix },
      })
    }

    return NextResponse.json({ success: true, message: result.message })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("numerators POST error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
