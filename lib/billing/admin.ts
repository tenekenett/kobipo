// Sistem-admin abonelik/sipariş yönetimi için yardımcılar. Yalnızca süper-admin uçlarından çağrılır.
import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS } from "@/lib/modules"
import { applyEntitlements, resolveAccountRootId } from "@/lib/billing/entitlements"
import { TRIAL_PLAN_CODE } from "@/lib/billing/catalog"

export type ResetMode = "trial" | "locked"

export function isResetMode(v: unknown): v is ResetMode {
  return v === "trial" || v === "locked"
}

/**
 * Bir hesabı (kök firma) test için temiz duruma çeker: sipariş + kullanım sayaçlarını siler ve
 * moda göre aboneliği/modül yetkilerini yeniden kurar. Şubeler hesap köküne dahildir.
 *
 * - "trial"  → taze 1 yıllık deneme (TÜM modüller açık; satın alma ekranı denenebilir).
 * - "locked" → deneme/abonelik EXPIRED, TÜM modüller kilitli (satın al → açılma akışı denenebilir).
 *
 * reconcile'ın ürettiği gerçek durumla tutarlıdır ([[lib/billing/entitlements.ts]]).
 */
export async function resetAccountBilling(companyId: string, mode: ResetMode) {
  const rootId = await resolveAccountRootId(companyId)
  const branchIds = (
    await prisma.company.findMany({ where: { parentCompanyId: rootId }, select: { id: true } })
  ).map((b) => b.id)
  const scopeIds = [rootId, ...branchIds]

  // Abonelik oluşturmak için sahip kullanıcı: mevcut aboneliğin userId'si → yoksa ilk üye.
  const existingSub = await prisma.subscription.findFirst({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  })
  let userId = existingSub?.userId ?? null
  if (!userId) {
    const uc = await prisma.userCompany.findFirst({
      where: { companyId: rootId },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    })
    userId = uc?.userId ?? null
  }

  // Ortak temizlik: kullanım sayaçları (kök + şubeler) + siparişler (kökte tutulur).
  await prisma.usageLimit.deleteMany({ where: { companyId: { in: scopeIds } } })
  await prisma.packageOrder.deleteMany({ where: { companyId: rootId } })

  const now = new Date()

  if (mode === "trial") {
    if (!userId) throw new Error("Firmada kullanıcı yok; deneme aboneliği oluşturulamadı")
    const trialEndsAt = new Date(now)
    trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1)
    const freePlan = await prisma.plan.upsert({
      where: { code: TRIAL_PLAN_CODE },
      update: {},
      create: {
        code: TRIAL_PLAN_CODE,
        name: "Ucretsiz (1 Yil)",
        monthlyPrice: 0,
        maxCompanies: 1,
        maxUsers: 1,
        maxInvoicesPerMonth: 100,
        isActive: true,
      },
    })
    await prisma.subscription.deleteMany({ where: { companyId: rootId } })
    await prisma.subscription.create({
      data: {
        userId,
        companyId: rootId,
        planId: freePlan.id,
        provider: "NONE",
        status: "TRIAL",
        trialEndsAt,
        periodStart: now,
        periodEnd: trialEndsAt,
      },
    })
    await applyEntitlements(rootId, [...MODULE_KEYS]) // deneme = tüm modüller açık
  } else {
    // locked: mevcut abonelikleri EXPIRED'a çek (tarihleri geçmişe), modülleri kilitle.
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    await prisma.subscription.updateMany({
      where: { companyId: rootId },
      data: { status: "EXPIRED", trialEndsAt: past, periodEnd: past },
    })
    await applyEntitlements(rootId, []) // hiçbiri açık değil → tüm modüller kilitli
  }

  return { rootId, mode, scopeCompanies: scopeIds.length }
}
