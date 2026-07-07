import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isBillingCycle } from "@/lib/billing/constants"
import { computeOrder, type PlanPricing } from "@/lib/billing/pricing"
import { toPricingMap, TRIAL_PLAN_CODE } from "@/lib/billing/catalog"
import { resolveAccountRootId } from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"

/** GET — hesabın paket siparişleri (ödeme sayfası poll'ü için). */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  const rootId = await resolveAccountRootId(companyId)

  const orders = await prisma.packageOrder.findMany({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  return NextResponse.json({ data: orders })
}

/**
 * POST — paket/abonelik siparişi oluştur. Tutar SUNUCUDA hesaplanır.
 * Body: { companyId, planId?, chosenModules[], branchQuota, billingCycle, autoRenew? }
 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    const access = await ensureCompanyAccess(companyId)
    if (access.role !== "ADMIN") {
      return NextResponse.json({ error: "Abonelik yönetimi yalnızca firma yöneticisine açıktır" }, { status: 403 })
    }

    const billingCycle = body?.billingCycle
    if (!isBillingCycle(billingCycle)) {
      return NextResponse.json({ error: "Geçersiz ödeme periyodu" }, { status: 400 })
    }

    const rootId = await resolveAccountRootId(companyId)

    // Paket (bundle) — verilmişse aktif ve satılabilir olmalı.
    let planPricing: PlanPricing | null = null
    let planName: string | null = null
    let planId: string | null = null
    if (body?.planId) {
      const plan = await prisma.plan.findUnique({ where: { id: String(body.planId) } })
      if (!plan || !plan.isActive || plan.code === TRIAL_PLAN_CODE) {
        return NextResponse.json({ error: "Geçersiz paket" }, { status: 400 })
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
      }
    }

    const pricingItems = await prisma.pricingItem.findMany({ where: { isActive: true } })
    const pricingMap = toPricingMap(pricingItems)

    const chosenModules = Array.isArray(body?.chosenModules) ? body.chosenModules.map(String) : []
    const branchQuota = Math.max(0, Math.floor(Number(body?.branchQuota) || 0))

    const computed = computeOrder({
      plan: planPricing,
      chosenModules,
      branchQuota,
      billingCycle,
      pricing: pricingMap,
    })

    if (computed.amount <= 0) {
      return NextResponse.json(
        { error: "Seçiminiz için ödenecek tutar yok. Lütfen bir paket veya modül seçin." },
        { status: 400 },
      )
    }
    if (computed.resolvedModules.length === 0 && computed.branchQuota === 0) {
      return NextResponse.json({ error: "Lütfen en az bir modül seçin." }, { status: 400 })
    }

    const order = await prisma.packageOrder.create({
      data: {
        companyId: rootId,
        planId,
        planName,
        selectedModules: computed.extraModules,
        resolvedModules: computed.resolvedModules,
        branchQuota: computed.branchQuota,
        billingCycle,
        amount: computed.amount,
        currency: "TRY",
        autoRenew: body?.autoRenew == null ? true : Boolean(body.autoRenew),
        status: "PENDING_PAYMENT",
        createdById: user.id,
      },
    })

    return NextResponse.json({
      id: order.id,
      amount: computed.amount,
      resolvedModules: computed.resolvedModules,
      branchQuota: computed.branchQuota,
      lines: computed.lines,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("billing orders POST error:", error)
    return NextResponse.json({ error: message || "Sipariş oluşturulamadı" }, { status: 500 })
  }
}
