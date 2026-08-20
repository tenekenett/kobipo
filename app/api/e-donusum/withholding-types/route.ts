import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { createPartnerProvider } from "@/lib/integrations/e-invoice/partner"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * GİB tevkifat kod listesi (Swagger v8: GET /api/GeneralCard/withholdingTaxType).
 * Fatura editöründe "hazır tevkifat kodları" seçicisini besler.
 *
 * Liste ulusal GİB tanımlarıdır (tenant'a göre değişmez); bu yüzden başarılı
 * sonucu Mysoft baseUrl bazında modül-içi önbelleğe alıp Mysoft'u her açılışta
 * yormuyoruz. Önbellek sunucu örneği ömrü boyunca / TTL kadar geçerlidir.
 *
 * Sağlayıcı seçimi: firmanın kendi e-Dönüşüm kimliği varsa onu kullanırız;
 * yoksa (kimlik eksik ya da çözülemiyor) bayi/partner hesabına düşeriz — liste
 * ulusal veri olduğu için bayi hesabıyla da doğru döner. Böylece kendi
 * e-Dönüşümünü kurmamış firmalarda da kod seçici serbest orana düşmez.
 */

type WithholdingType = { code: string; name: string; rate: number }

const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 saat
const cache = new Map<string, { at: number; data: WithholdingType[] }>()

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    // Tevkifat listesi ulusal GİB verisidir; hangi Mysoft hesabıyla çekildiğinden
    // bağımsız olarak aynı gelir. Bu yüzden DAİMA uygulama geneli bayi (partner)
    // hesabıyla çekeriz: firmanın kendi e-Dönüşümü kurulu olmasa da liste gelir ve
    // firma şifresini çözmeye gerek kalmaz. Partner yapılandırılmamışsa (regresyon
    // olmasın diye) firmanın kendi kimliğine düşeriz.
    let provider: MysoftEInvoiceProvider | null = createPartnerProvider()
    let cacheKey = "partner"
    if (!provider) {
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
      if (company?.eDonusumApiUsername && company?.eDonusumApiPassword) {
        try {
          provider = new MysoftEInvoiceProvider({
            username: company.eDonusumApiUsername,
            passwordText: decryptSecret(company.eDonusumApiPassword),
            baseUrl: company.eDonusumApiUrl || undefined,
            vknTckn: effectiveTenantVkn(company) || undefined,
          })
          cacheKey = company.eDonusumApiUrl || "default"
        } catch {
          provider = null
        }
      }
    }
    if (!provider) {
      return NextResponse.json(
        {
          error:
            "Tevkifat listesi için Mysoft yapılandırması yok. Sunucudaki bayi (partner) hesabını ya da firma e-Dönüşüm kimliğini kontrol edin.",
        },
        { status: 400 },
      )
    }

    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: cached.data, cached: true })
    }

    const result = await provider.listWithholdingTaxTypes()
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Tevkifat listesi alınamadı" }, { status: 502 })
    }

    const data = result.data || []
    cache.set(cacheKey, { at: Date.now(), data })
    return NextResponse.json({ data })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("withholding-types GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
