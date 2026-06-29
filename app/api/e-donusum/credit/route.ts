import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * Mysoft Firma Kontör Bilgisi (Swagger v8):
 *   POST /api/Tenant/getCreditInfo  — kalan kontör listesi
 *
 * identifierNumber Mysoft tarafında ZORUNLU. Doğrulanmış VKN
 * `company.eDonusumTenantVkn` alanından okunur — boşsa kullanıcıyı önce
 * E-Dönüşüm Ayarları'na yönlendiriyoruz.
 */

const ERR_NO_VERIFIED_VKN =
  "Mysoft mükellef VKN'niz tanımlı değil. Firma Ayarları sayfasından firma VKN/TCKN bilginizi girin."

async function loadCredsAndVerifiedVkn(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      eDonusumApiUsername: true,
      eDonusumApiPassword: true,
      eDonusumApiUrl: true,
      eDonusumTenantVkn: true,
      taxNumber: true,
    },
  })
  if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) return null
  // VKN doğrulama akışı kaldırıldı — eDonusumTenantVkn açıkça kaydedilmemişse
  // firmanın kendi VKN/TCKN'sine fallback yap (zaten ayarlar UI'ı da bu değerle
  // doluyor; kullanıcının ayrıca "Kaydet" demesini bekleme).
  const vkn = (company.eDonusumTenantVkn || company.taxNumber || "").replace(/\D/g, "")
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

    const result = await provider.getCreditInfo(creds.vkn)
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Kontör bilgisi alınamadı" }, { status: 502 })
    }
    return NextResponse.json({
      data: result.data || [],
      usage: result.usage || [],
      source: result.source || null,
      tenantVkn: creds.vkn,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("credit GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
