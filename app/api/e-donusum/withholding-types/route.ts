import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"

export const dynamic = "force-dynamic"

/**
 * GİB tevkifat kod listesi (Swagger v8: GET /api/GeneralCard/withholdingTaxType).
 * Fatura editöründe "hazır tevkifat kodları" seçicisini besler.
 *
 * Liste ulusal GİB tanımlarıdır (tenant'a göre değişmez); bu yüzden başarılı
 * sonucu Mysoft baseUrl bazında modül-içi önbelleğe alıp Mysoft'u her açılışta
 * yormuyoruz. Önbellek sunucu örneği ömrü boyunca / TTL kadar geçerlidir.
 */

type WithholdingType = { code: string; name: string; rate: number }

const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 saat
const cache = new Map<string, { at: number; data: WithholdingType[] }>()

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)
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
      return NextResponse.json(
        { error: "Mysoft API bilgileri eksik. E-Dönüşüm Ayarları'nı kontrol edin." },
        { status: 400 },
      )
    }

    const baseUrl = company.eDonusumApiUrl || "default"
    const cached = cache.get(baseUrl)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: cached.data, cached: true })
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
      vknTckn: effectiveTenantVkn(company) || undefined,
    })

    const result = await provider.listWithholdingTaxTypes()
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Tevkifat listesi alınamadı" }, { status: 502 })
    }

    const data = result.data || []
    cache.set(baseUrl, { at: Date.now(), data })
    return NextResponse.json({ data })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("withholding-types GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
