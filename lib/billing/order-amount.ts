// Paket/abonelik siparişinin TUTARINI çözen ortak yol.
//
// İki uç aynı tutarı görmek zorunda: siparişi açan `POST /api/billing/orders` ve
// indirim kodunu doğrulayan `POST /api/discount-codes/validate`. Ayrı hesaplarlarsa
// ekranda "şu kadar indirim" yazar, tahsilat başka tutardan geçer. Bu yüzden hesap
// tek yerde durur ve ikisi de buradan geçer.
//
// İstemciden gelen tutara ASLA bakılmaz: seçim (plan, modüller, kota, periyot)
// alınır, fiyat sunucudaki katalogdan yeniden hesaplanır.

import { prisma } from "@/lib/db/prisma"
import { computeOrder, type PlanPricing, type ComputedOrder } from "@/lib/billing/pricing"
import { toPricingMap, TRIAL_PLAN_CODE } from "@/lib/billing/catalog"
import { isBillingCycle } from "@/lib/billing/constants"

export type PackageSelectionInput = {
  planId?: unknown
  chosenModules?: unknown
  branchQuota?: unknown
  companyQuota?: unknown
  billingCycle?: unknown
}

export type PackageAmountResult =
  | { ok: true; computed: ComputedOrder; planId: string | null; planName: string | null }
  | { ok: false; status: number; error: string }

/** Seçimden fiyatı çözer. Hata durumları çağıranın döneceği HTTP durumunu taşır. */
export async function resolvePackageOrderAmount(
  body: PackageSelectionInput,
): Promise<PackageAmountResult> {
  const billingCycle = body?.billingCycle
  if (!isBillingCycle(billingCycle)) {
    return { ok: false, status: 400, error: "Geçersiz ödeme periyodu" }
  }

  let planPricing: PlanPricing | null = null
  let planName: string | null = null
  let planId: string | null = null
  if (body?.planId) {
    const plan = await prisma.plan.findUnique({ where: { id: String(body.planId) } })
    if (!plan || !plan.isActive || plan.code === TRIAL_PLAN_CODE) {
      return { ok: false, status: 400, error: "Geçersiz paket" }
    }
    planId = plan.id
    planName = plan.name
    planPricing = {
      id: plan.id,
      name: plan.name,
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: plan.yearlyPrice != null ? Number(plan.yearlyPrice) : null,
      includedModules: plan.includedModules,
      includedBranches: plan.includedBranches,
      includedCompanies: plan.includedCompanies,
    }
  }

  const pricingItems = await prisma.pricingItem.findMany({ where: { isActive: true } })
  const computed = computeOrder({
    plan: planPricing,
    chosenModules: Array.isArray(body?.chosenModules) ? body.chosenModules.map(String) : [],
    branchQuota: Math.max(0, Math.floor(Number(body?.branchQuota) || 0)),
    companyQuota: Math.max(0, Math.floor(Number(body?.companyQuota) || 0)),
    billingCycle,
    pricing: toPricingMap(pricingItems),
  })

  if (computed.amount <= 0) {
    return {
      ok: false,
      status: 400,
      error: "Seçiminiz için ödenecek tutar yok. Lütfen bir paket veya modül seçin.",
    }
  }
  if (
    computed.resolvedModules.length === 0 &&
    computed.branchQuota === 0 &&
    computed.companyQuota === 0
  ) {
    return { ok: false, status: 400, error: "Lütfen en az bir modül seçin." }
  }

  return { ok: true, computed, planId, planName }
}
