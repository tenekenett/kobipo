import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isPaytrEnabled } from "@/lib/integrations/paytr/client"
import { getSellablePlans, ensureDefaultPricingItems } from "@/lib/billing/catalog"
import {
  getAccountSubscription,
  resolveAccountRootId,
  countAccountBranches,
  isTrialActive,
  isPaidActive,
} from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"

/**
 * Müşteri abonelik ekranını besleyen tek uç: satılabilir paketler + à la carte fiyatlar +
 * hesabın mevcut abonelik özeti + PayTR durumu. Hepsi hesap (kök firma) düzeyindedir.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  const rootId = await resolveAccountRootId(companyId)

  await ensureDefaultPricingItems()
  const [plans, pricing, sub, currentBranches] = await Promise.all([
    getSellablePlans(false),
    prisma.pricingItem.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    getAccountSubscription(rootId),
    countAccountBranches(rootId),
  ])

  const subscription = sub
    ? {
        status: sub.status,
        planId: sub.planId,
        planName: sub.plan?.name ?? null,
        billingCycle: sub.billingCycle,
        purchasedModules: sub.purchasedModules,
        branchQuota: sub.branchQuota,
        amount: sub.amount != null ? Number(sub.amount) : null,
        autoRenew: sub.autoRenew,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        trialEndsAt: sub.trialEndsAt,
        periodEnd: sub.periodEnd,
        isTrialActive: isTrialActive(sub),
        isPaidActive: isPaidActive(sub),
      }
    : null

  return NextResponse.json({
    paytrEnabled: isPaytrEnabled(),
    currency: "TRY",
    plans,
    pricing,
    subscription,
    currentBranches,
  })
}
