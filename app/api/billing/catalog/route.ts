import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolvePurchaseAuthority } from "@/lib/billing/purchase-authority"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isPaytrEnabled } from "@/lib/integrations/paytr/client"
import { getSellablePlans, ensureDefaultPricingItems } from "@/lib/billing/catalog"
import { freeModulesFromPricingItems } from "@/lib/billing/free-modules"
import {
  getCompanySubscription,
  resolveAccountRootId,
  countAccountBranches,
  countAccountCompanies,
  isTrialActive,
  isPaidActive,
} from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"

/**
 * Müşteri abonelik ekranını besleyen tek uç: satılabilir paketler + à la carte fiyatlar +
 * FİRMANIN mevcut abonelik özeti + PayTR durumu.
 *
 * İki eksen bilerek ayrı: MODÜL aboneliği firmanındır (şube ana firmanınkinden
 * yararlanmaz), KOTA hesabındır (şube/ek firma açma hakkı kök abonelikte, tek havuz).
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  const access = await ensureCompanyAccess(companyId)

  const rootId = await resolveAccountRootId(companyId)

  // SATIN ALMA YETKİSİ — sipariş ucuyla AYNI fonksiyondan (bkz.
  // lib/billing/purchase-authority.ts). Ekran bunu bilmezse kullanıcı formu doldurup
  // ödeme adımında 403 yerdi; sebebi de taşıyoruz ki uyarı doğru cümleyi yazsın.
  const authority = resolvePurchaseAuthority({
    companyRole: access.role,
    isAccountRoot: rootId === companyId,
    isSuperAdmin: user.isSuperAdmin,
    isAccountRootAdmin:
      rootId === companyId
        ? false
        : (await prisma.userCompany.findFirst({
            where: { userId: user.id, companyId: rootId, role: "ADMIN" },
            select: { id: true },
          })) != null,
  })

  await ensureDefaultPricingItems()
  const [plans, pricing, sub, currentBranches, currentCompanies, company, accountRoot] =
    await Promise.all([
    getSellablePlans(false),
    // `isActive` filtresi YOK: ücretsiz bir modül satılmadığı için pasife alınmış
    // olabilir ama ekranda "Ücretsiz" olarak görünmek zorunda. Fiyat haritasına yalnız
    // aktifler girer (aşağıda), ücretsiz kümesi tüm satırlardan çözülür.
    prisma.pricingItem.findMany({ orderBy: { sortOrder: "asc" } }),
    getCompanySubscription(companyId),
    countAccountBranches(rootId),
    countAccountCompanies(rootId),
    // ELLE KAPATILAN temel modüller — kapsam FİRMA bazındadır, bu yüzden kökün değil
    // ekranın açık olduğu firmanın satırı okunur.
    prisma.company.findUnique({
      where: { id: companyId },
      select: { suppressedModules: true },
    }),
    // Kök firmanın adı: şubede "kotayı ana firmadan alın" cümlesi adıyla yazılır.
    prisma.company.findUnique({
      where: { id: rootId },
      select: { name: true, branchName: true, slug: true },
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
    // Ekran KOTA kartlarını yalnız hesap kökünde çizsin: şube/ek firma kendi modül
    // aboneliğini alır ama şube/firma AÇMA hakkı hesap düzeyindedir ve yalnız kökten
    // satın alınır (uç da aynı kuralı zorluyor, bkz. app/api/billing/orders/route.ts).
    isAccountRoot: rootId === companyId,
    canPurchase: authority.ok,
    purchaseBlockedReason: authority.reason,
    accountName: accountRoot?.name ?? null,
    subscription,
    currentBranches,
    currentCompanies,
  })
})
