import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  createPartnerProvider,
  PARTNER_NOT_CONFIGURED_ERROR,
} from "@/lib/integrations/e-invoice/partner"

export const dynamic = "force-dynamic"

/**
 * Firmanın Mysoft aktivasyon (GİB başvuru) durumunu bayi kimliğiyle sorgular ve
 * Company.eDonusumOnboardingStatus'ü günceller.
 * Swagger activationDemandStatus: WillBeSendToGib → SentToGib → Approved / Canceled /
 * Error / Wait / Close. Dönen değer İngilizce enum veya Türkçe görünen metin olabilir.
 * Plan: docs/e-donusum-onboarding/PLAN.md
 */

type ActState = "approved" | "error" | "pending"

function classify(demandStatus: string | null): ActState {
  const s = (demandStatus || "").toLowerCase()
  if (/approved|onayland/.test(s)) return "approved"
  if (/error|hata|cancel|iptal/.test(s)) return "error"
  return "pending"
}

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        taxNumber: true,
        eDonusumTenantVkn: true,
        eDonusumOnboardingStatus: true,
        eDonusumActivatedProducts: true,
        eFaturaPrefix: true,
        eArchivePrefix: true,
      },
    })
    if (!company) return NextResponse.json({ success: false, error: "Firma bulunamadı" }, { status: 404 })

    const vkn = (company.eDonusumTenantVkn || company.taxNumber || "").replace(/\D/g, "")
    if (!/^\d{10,11}$/.test(vkn)) {
      return NextResponse.json({ success: false, error: "Firma VKN/TCKN geçersiz." }, { status: 400 })
    }

    const provider = createPartnerProvider()
    if (!provider) {
      return NextResponse.json({ success: false, error: PARTNER_NOT_CONFIGURED_ERROR }, { status: 400 })
    }

    const result = await provider.getTenantActivationStatus(vkn)
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || "Durum alınamadı" }, { status: 502 })
    }

    const rows = result.data || []
    const activations = rows.map((r) => ({
      productType: r.productType,
      demandStatus: r.demandStatus,
      state: classify(r.demandStatus),
      gibServiceStatus: r.gibServiceStatus,
      gibServiceMessage: r.gibServiceMessage,
      serialNumberPrefix: r.serialNumberPrefix,
    }))

    const submitted = company.eDonusumActivatedProducts || []
    const approvedTypes = new Set(
      activations.filter((a) => a.state === "approved" && a.productType).map((a) => a.productType as string),
    )

    // GERÇEĞİ KAYNAK AL: Mysoft'ta onaylı görünen ürünleri kendi kaydımıza da yaz.
    // Gerekli, çünkü POST sırasında Mysoft bize hata dönse bile aktivasyon gerçekte
    // oluşmuş olabiliyor — 2026-08-03'te EInvoice "HATA" diye kaydedildi ama GİB
    // "BAŞARIYLA TAMAMLANDI" (1300) ile onaylamıştı. Bu senkron olmadan firma
    // eDonusumActivatedProducts=[] ile sonsuza kadar FAILED'da kalıyordu: allApproved
    // yalnız BİZİM kaydımıza baktığı için "Durumu Yenile" hiçbir zaman kurtaramıyordu.
    const merged = Array.from(new Set([...submitted, ...approvedTypes]))
    const allApproved = merged.length > 0 && merged.every((t) => approvedTypes.has(t))

    // Onaylı aktivasyonun seri ön ekini firmaya yaz — numaratör GİB'deki ile aynı olsun.
    // (Mysoft prefix'i kendi atamış olabilir; ASDOĞUŞ örneğinde EInvoice → "ADE".)
    const prefixOf = (type: string) =>
      activations.find((a) => a.productType === type && a.state === "approved" && a.serialNumberPrefix)
        ?.serialNumberPrefix || null
    const eFaturaPrefix = prefixOf("EInvoice")
    const eArchivePrefix = prefixOf("EArchive")

    const syncData: Record<string, unknown> = {}
    if (merged.length !== submitted.length) syncData.eDonusumActivatedProducts = merged
    if (eFaturaPrefix && eFaturaPrefix !== company.eFaturaPrefix) syncData.eFaturaPrefix = eFaturaPrefix
    if (eArchivePrefix && eArchivePrefix !== company.eArchivePrefix) syncData.eArchivePrefix = eArchivePrefix
    if (Object.keys(syncData).length > 0) {
      await prisma.company.update({ where: { id: companyId }, data: syncData })
    }

    let nextStatus = company.eDonusumOnboardingStatus || null
    // Durumu yalnızca ileriye taşı — geri (ACTIVE→PENDING) düşürme.
    if (allApproved && company.eDonusumOnboardingStatus !== "ACTIVE") {
      nextStatus = "ACTIVE"
      // Tüm ürünler GİB'de onaylandı → firma artık bayi kimliğiyle e-belge kesebilir.
      // isEDonusumEnabled=true ile fatura gönderme akışını (send-invoice-helper) aç.
      await prisma.company.update({
        where: { id: companyId },
        data: {
          eDonusumOnboardingStatus: "ACTIVE",
          eDonusumActivationError: null,
          isEDonusumEnabled: true,
        },
      })
    }

    return NextResponse.json({
      success: true,
      vkn,
      status: nextStatus,
      allApproved,
      submitted: merged,
      activations,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
    }
    console.error("e-donusum onboarding status GET error:", error)
    return NextResponse.json({ success: false, error: message || "Durum sorgulanırken hata oluştu" }, { status: 500 })
  }
})
