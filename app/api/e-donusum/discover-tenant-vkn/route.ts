import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * Mysoft Tenant VKN otomatik keşfi.
 *  1) /api/Tenant/getTenant — bayi/partner yetkisi varsa kullanıcının yönettiği
 *     mükellef listesini döner. SaaS müşterisinde genelde yetki yok (403).
 *  2) JWT'den 10/11 haneli numeric claim'leri aday olarak listele (kesin değil,
 *     userId/customerId vs. olabilir; doğrulama gerektirir).
 *
 * Bu endpoint sadece ADAY'ları döner — kaydetmek için verify-tenant-vkn çağrılır.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { companyId } = body || {}
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Önce E-Dönüşüm Ayarları'na API kullanıcı adı/şifresini yazıp kaydedin." },
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
    })

    // 1) Bayi/partner listesi
    const tenantsRes = await provider.listTenants()
    const tenants = (tenantsRes.success && Array.isArray(tenantsRes.data))
      ? tenantsRes.data
          .filter((t) => !t.isPassive && typeof t.vknTckn === "string" && t.vknTckn.trim())
          .map((t) => ({
            vknTckn: String(t.vknTckn).trim(),
            tenantName: t.tenantName || "",
            shortName: t.shortName || "",
          }))
      : []

    // 2) JWT keşif (aday — doğrulanması şart). Tüm 10/11 haneli claim adaylarını
    //    döndür; biri tenant, diğeri userId/customerId olabilir. Kullanıcı seçer.
    const jwt = await provider.discoverTenantFromToken()
    const jwtCandidates: string[] = jwt.success && Array.isArray(jwt.candidateValues)
      ? Array.from(
          new Set(
            jwt.candidateValues
              .map((c) => (typeof c.value === "string" ? c.value : ""))
              .filter((v) => /^\d{10,11}$/.test(v)),
          ),
        )
      : []
    const jwtCandidate = jwtCandidates[0] || null

    return NextResponse.json({
      tenants,
      jwtCandidate,
      jwtCandidates,
      tenantListError: tenantsRes.success ? null : tenantsRes.error || null,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("discover-tenant-vkn error:", error)
    return NextResponse.json(
      { error: message || "Keşif sırasında hata." },
      { status: 500 },
    )
  }
}
