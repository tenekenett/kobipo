import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isPaytrEnabled } from "@/lib/integrations/paytr/client"
import { getSellablePlans, ensureDefaultPricingItems } from "@/lib/billing/catalog"
import { freeModulesFromPricingItems } from "@/lib/billing/free-modules"
import {
  getAccountSubscription,
  resolveAccountRootId,
  countAccountBranches,
  countAccountCompanies,
  isTrialActive,
  isPaidActive,
} from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"

/**
 * Müşteri abonelik ekranını besleyen tek uç: satılabilir paketler + à la carte fiyatlar +
 * hesabın mevcut abonelik özeti + PayTR durumu. Hepsi hesap (kök firma) düzeyindedir.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  const rootId = await resolveAccountRootId(companyId)

  await ensureDefaultPricingItems()
  const [plans, pricing, sub, currentBranches, currentCompanies, company] = await Promise.all([
    getSellablePlans(false),
    // `isActive` filtresi YOK: ücretsiz bir modül satılmadığı için pasife alınmış
    // olabilir ama ekranda "Ücretsiz" olarak görünmek zorunda. Fiyat haritasına yalnız
    // aktifler girer (aşağıda), ücretsiz kümesi tüm satırlardan çözülür.
    prisma.pricingItem.findMany({ orderBy: { sortOrder: "asc" } }),
    getAccountSubscription(rootId),
    countAccountBranches(rootId),
    countAccountCompanies(rootId),
    // ELLE KAPATILAN temel modüller — kapsam FİRMA bazındadır, bu yüzden kökün değil
    // ekranın açık olduğu firmanın satırı okunur.
    prisma.company.findUnique({
      where: { id: companyId },
      select: { suppressedModules: true },
    }),
  ])

  const subscription = sub
    ? {
        status: sub.status,
        planId: sub.planId,
        planName: sub.plan?.name ?? null,
        billingCycle: sub.billingCycle,
        purchasedModules: sub.purchasedModules,
        branchQuota: sub.branchQuota,
        companyQuota: sub.companyQuota,
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
    pricing: pricing.filter((p) => p.isActive || p.isFree),
    // TEMEL modüller: satın alınmadan açık gelirler. Ekran bunları "Ücretsiz" olarak
    // işaretler ve seçimden çıkarılamaz yapar; tutar hesabı da bunları atlar
    // (lib/billing/pricing.ts → computeOrder). Sunucu bu kümenin tek kaynağıdır.
    freeModules: freeModulesFromPricingItems(pricing),
    // Sistem yöneticisinin bu firmada kapattığı temel modüller: ekranda hiç
    // görünmezler. `freeModules`tan DÜŞÜLMEZ — o küme tutar hesabının girdisi ve
    // sunucudaki fiyatlamayla (lib/billing/pricing.ts) birebir aynı kalmalı.
    suppressedModules: company?.suppressedModules ?? [],
    subscription,
    currentBranches,
    currentCompanies,
  })
})
