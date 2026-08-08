import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { createPartnerProvider } from "@/lib/integrations/e-invoice/partner"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"
import {
  GIB_EXCISE_TAX_TYPES,
  GIB_OTHER_TAX_TYPES,
  type GibTaxType,
} from "@/lib/integrations/e-invoice/gib-tax-types"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * GİB vergi türü listeleri (ÖTV + KDV/ÖTV dışı "diğer vergiler"). Fatura
 * editöründeki ÖTV ve Diğer Vergi seçicilerini besler — tevkifat seçicisinin
 * (/api/e-donusum/withholding-types) vergi türü karşılığıdır.
 *
 * Veri kaynağı önceliği: VARSA Mysoft (GET /api/GeneralCard/taxType — Swagger
 * v8'de henüz yok, yoklanır), YOKSA gömülü GİB UBL-TR listesi. Liste ulusal GİB
 * tanımı olduğundan gömülü fallback her zaman tam ve doğrudur; bu yüzden bu uç
 * tevkifat ucunun aksine Mysoft yapılandırması olmayan firmada da 200 döner.
 *
 * Mysoft dönerse kodlar iki kovaya ayrılır: bilinen ÖTV liste kodları → excise,
 * kalanlar → other. KDV (0015) ve tevkifat türleri (9015 KDV tevk., 4171 ÖTV
 * tevk., 0003/0011 stopaj) bu seçicilere ait olmadığından elenir. Mysoft oran
 * vermezse gömülü listedeki standart oran (ör. Konaklama %2) korunur.
 */

type TaxTypesPayload = { excise: GibTaxType[]; other: GibTaxType[]; source: "mysoft" | "gib" }

const EXCISE_CODE_SET = new Set(GIB_EXCISE_TAX_TYPES.map((t) => t.code))
const EXCLUDED_CODES = new Set(["0015", "9015", "4171", "0003", "0011"])
const GIB_RATE_BY_CODE = new Map(
  [...GIB_EXCISE_TAX_TYPES, ...GIB_OTHER_TAX_TYPES].map((t) => [t.code, t.rate] as const),
)

const GIB_FALLBACK: TaxTypesPayload = {
  excise: GIB_EXCISE_TAX_TYPES,
  other: GIB_OTHER_TAX_TYPES,
  source: "gib",
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 saat
const cache = new Map<string, { at: number; data: TaxTypesPayload }>()

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    // Sağlayıcı seçimi tevkifat ucundaki desenle aynı: liste ulusal veri olduğu
    // için önce uygulama geneli bayi (partner) hesabı; yoksa firmanın kendi
    // e-Dönüşüm kimliği. Hiçbiri yoksa doğrudan gömülü GİB listesi döner.
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
    if (!provider) return NextResponse.json({ data: GIB_FALLBACK })

    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: cached.data, cached: true })
    }

    const result = await provider.listTaxTypes()
    let payload: TaxTypesPayload = GIB_FALLBACK
    if (result.success && result.data && result.data.length > 0) {
      const excise: GibTaxType[] = []
      const other: GibTaxType[] = []
      for (const t of result.data) {
        if (EXCLUDED_CODES.has(t.code)) continue
        const merged: GibTaxType = { ...t, rate: t.rate ?? GIB_RATE_BY_CODE.get(t.code) }
        if (EXCISE_CODE_SET.has(t.code)) excise.push(merged)
        else other.push(merged)
      }
      payload = {
        // Mysoft kovalardan birini boş bırakırsa o kova gömülü listeden tamamlanır —
        // seçiciler hiçbir durumda boş kalmamalı (kod GİB gönderiminde zorunlu).
        excise: excise.length > 0 ? excise : GIB_EXCISE_TAX_TYPES,
        other: other.length > 0 ? other : GIB_OTHER_TAX_TYPES,
        source: "mysoft",
      }
    }
    // Fallback da önbelleğe alınır: uç Mysoft'ta yokken her istekte yeniden
    // yoklamayalım (TTL dolunca bir kez daha denenir — uç eklenirse akar).
    cache.set(cacheKey, { at: Date.now(), data: payload })
    return NextResponse.json({ data: payload })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("tax-types GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
