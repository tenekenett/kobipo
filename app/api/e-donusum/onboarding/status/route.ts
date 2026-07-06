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

export async function GET(request: Request) {
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

    // Bizim başvurduğumuz ürünlerin hepsi onaylandıysa → ACTIVE.
    const submitted = company.eDonusumActivatedProducts || []
    const approvedTypes = new Set(
      activations.filter((a) => a.state === "approved" && a.productType).map((a) => a.productType as string),
    )
    const allApproved =
      submitted.length > 0 && submitted.every((t) => approvedTypes.has(t))

    let nextStatus = company.eDonusumOnboardingStatus || null
    // Durumu yalnızca ileriye taşı — geri (ACTIVE→PENDING) düşürme.
    if (allApproved && company.eDonusumOnboardingStatus !== "ACTIVE") {
      nextStatus = "ACTIVE"
      await prisma.company.update({
        where: { id: companyId },
        data: { eDonusumOnboardingStatus: "ACTIVE", eDonusumActivationError: null },
      })
    }

    return NextResponse.json({
      success: true,
      vkn,
      status: nextStatus,
      allApproved,
      submitted,
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
}
