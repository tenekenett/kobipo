import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"

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

type LoadResult =
  | { ok: true; provider: MysoftEInvoiceProvider; vkn: string }
  | { ok: false; status: number; error: string }

/**
 * Numaratör işlemleri için firmanın Mysoft provider'ını ve mükellef VKN'sini çözer.
 * Firmanın kendi kimliği (manuel) yoksa bayi + firma VKN yoluna düşer (Faz 4).
 */
async function loadProviderAndVkn(companyId: string): Promise<LoadResult> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: COMPANY_PROVIDER_SELECT,
  })
  const resolved = resolveCompanyEInvoiceProvider(company)
  if (!resolved.ok) return resolved
  // Mükellef VKN doğrudan firmanın kendi VKN'sinden çekilir (doğrulama adımı yok).
  if (!resolved.tenantVkn) return { ok: false, status: 412, error: ERR_NO_VERIFIED_VKN }
  return { ok: true, provider: resolved.provider, vkn: resolved.tenantVkn }
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const loaded = await loadProviderAndVkn(companyId)
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    }
    const provider = loaded.provider

    const result = await provider.listNumerators(loaded.vkn)
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Liste alınamadı" }, { status: 502 })
    }
    return NextResponse.json({ data: result.data || [], tenantVkn: loaded.vkn })
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
    body.companyId = await resolveCompanyId(body.companyId)
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

    const loaded = await loadProviderAndVkn(companyId)
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    }
    const provider = loaded.provider

    const cleanPrefix = prefix.trim().toUpperCase()
    const result = await provider.addNumerator({
      prefix: cleanPrefix,
      eDocumentType: docType,
      isDefault: Boolean(isDefault),
      isInternetSales: Boolean(isInternetSales),
      isPassive: Boolean(isPassive),
      lastNumber: typeof lastNumber === "number" && Number.isFinite(lastNumber) ? lastNumber : 0,
      identifierNumber: loaded.vkn,
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
