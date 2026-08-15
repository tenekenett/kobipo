// Sistem-admin abonelik/sipariş yönetimi için yardımcılar. Yalnızca süper-admin uçlarından çağrılır.
import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS } from "@/lib/modules"
import {
  applyEntitlements,
  countAccountBranches,
  countAccountCompanies,
  getAccountCompanyIds,
  resolveAccountRootId,
} from "@/lib/billing/entitlements"
import { TRIAL_PLAN_CODE } from "@/lib/billing/catalog"
import { MAX_BRANCH_QUOTA, MAX_COMPANY_QUOTA } from "@/lib/billing/constants"

export type ResetMode = "trial" | "locked"

export function isResetMode(v: unknown): v is ResetMode {
  return v === "trial" || v === "locked"
}

/** Uçların HTTP durum kodu + koda çevirebildiği bilinen (beklenen) hata. */
export class BillingAdminError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = "BillingAdminError"
  }
}

/** Abonelik oluştururken sahip kullanıcı: mevcut aboneliğin userId'si → yoksa ilk üye. */
async function resolveAccountOwnerUserId(rootId: string): Promise<string | null> {
  const existingSub = await prisma.subscription.findFirst({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  })
  if (existingSub?.userId) return existingSub.userId
  const uc = await prisma.userCompany.findFirst({
    where: { companyId: rootId },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  })
  return uc?.userId ?? null
}

/** Deneme planı (FREE_1Y) kaydını garanti eder. */
async function upsertTrialPlan() {
  return prisma.plan.upsert({
    where: { code: TRIAL_PLAN_CODE },
    update: {},
    create: {
      code: TRIAL_PLAN_CODE,
      name: "Ucretsiz (1 Yil)",
      monthlyPrice: 0,
      maxUsers: 1,
      maxInvoicesPerMonth: 100,
      isActive: true,
    },
  })
}

/**
 * Bir hesabı (kök firma) test için temiz duruma çeker: sipariş + kullanım sayaçlarını siler ve
 * moda göre aboneliği/modül yetkilerini yeniden kurar. Hesabın tüm üyeleri (şubeler ve ek
 * firmalar) kapsama dahildir.
 *
 * - "trial"  → taze 1 yıllık deneme (TÜM modüller açık; satın alma ekranı denenebilir).
 * - "locked" → deneme/abonelik EXPIRED, TÜM modüller kilitli (satın al → açılma akışı denenebilir).
 *
 * reconcile'ın ürettiği gerçek durumla tutarlıdır ([[lib/billing/entitlements.ts]]).
 */
export async function resetAccountBilling(companyId: string, mode: ResetMode) {
  const rootId = await resolveAccountRootId(companyId)
  const scopeIds = await getAccountCompanyIds(rootId)

  const userId = await resolveAccountOwnerUserId(rootId)
  // Elle verilmiş kotalar sıfırlamada kaybolmasın: mevcut şube/firmalar kotanın üstünde
  // kalırsa hesap yeni şube ya da firma açamaz duruma düşerdi.
  const previous = await prisma.subscription.findFirst({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    select: { branchQuota: true, companyQuota: true },
  })
  const previousBranchQuota = previous?.branchQuota ?? 0
  const previousCompanyQuota = previous?.companyQuota ?? 0

  // Ortak temizlik: kullanım sayaçları (hesabın tümü) + siparişler (kökte tutulur).
  await prisma.usageLimit.deleteMany({ where: { companyId: { in: scopeIds } } })
  await prisma.packageOrder.deleteMany({ where: { companyId: rootId } })

  const now = new Date()

  if (mode === "trial") {
    if (!userId) throw new Error("Firmada kullanıcı yok; deneme aboneliği oluşturulamadı")
    const trialEndsAt = new Date(now)
    trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1)
    const freePlan = await upsertTrialPlan()
    await prisma.subscription.deleteMany({ where: { companyId: rootId } })
    await prisma.subscription.create({
      data: {
        userId,
        companyId: rootId,
        planId: freePlan.id,
        provider: "NONE",
        status: "TRIAL",
        branchQuota: previousBranchQuota,
        companyQuota: previousCompanyQuota,
        // Açılan modüller aboneliğe de yazılır: yetkinin kaynağı `purchasedModules`tır
        // ve yalnız `disabledModules` yazan bir override ilk yeniden hesaplamada silinir.
        // (TRIAL durumu tanım gereği modül ÜRETMEZ; bu alan, hesap ücretliye geçtiğinde
        // ya da elle ACTIVE'e alındığında override'ın ayakta kalmasını sağlar.)
        purchasedModules: [...MODULE_KEYS],
        trialEndsAt,
        periodStart: now,
        periodEnd: trialEndsAt,
      },
    })
    // Süper-admin override: modülleri elle açar. Deneme durumu KENDİLİĞİNDEN modül
    // vermez (bkz. resolveGrantedModules) — bu satır bilinçli bir demo/destek açmasıdır.
    await applyEntitlements(rootId, [...MODULE_KEYS])
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

/**
 * Hesabın (kök firma) ŞUBE ve/veya FİRMA kotasını elle ayarlar — satın alma akışı dışında,
 * destek/demo amaçlı. Kotalar HESAP düzeyindedir ve en güncel abonelik satırında tutulur;
 * şube/firma ekleme kontrolü de bu satırı okur (bkz. app/api/companies/route.ts).
 *
 * İki kota AYRI havuzdur, bu yüzden ikisi de opsiyoneldir: verilmeyen alan olduğu gibi
 * kalır. Tek çağrıda ikisini birden yazmak da mümkündür.
 *
 * Aboneliği olmayan hesapta kota tek başına ETKİSİZDİR (ekleme fail-closed çalışır, aktif
 * abonelik ister). Bu durumda çağıran `createTrialIfMissing` ile açıkça onay vermeli; o
 * zaman 1 yıllık deneme satırı açılır. Modül yetkilerine (disabledModules) DOKUNULMAZ —
 * kota vermek modül açmak değildir.
 */
export async function setAccountQuotas(
  companyId: string,
  quotas: { branchQuota?: number; companyQuota?: number },
  opts: { createTrialIfMissing?: boolean } = {},
) {
  const { branchQuota, companyQuota } = quotas
  if (branchQuota == null && companyQuota == null) {
    throw new BillingAdminError("branchQuota veya companyQuota verilmeli", "NO_QUOTA", 400)
  }
  if (
    branchQuota != null &&
    (!Number.isInteger(branchQuota) || branchQuota < 0 || branchQuota > MAX_BRANCH_QUOTA)
  ) {
    throw new BillingAdminError(
      `Şube kotası 0 ile ${MAX_BRANCH_QUOTA} arasında bir tam sayı olmalı`,
      "INVALID_QUOTA",
      400,
    )
  }
  if (
    companyQuota != null &&
    (!Number.isInteger(companyQuota) || companyQuota < 0 || companyQuota > MAX_COMPANY_QUOTA)
  ) {
    throw new BillingAdminError(
      `Firma kotası 0 ile ${MAX_COMPANY_QUOTA} arasında bir tam sayı olmalı`,
      "INVALID_QUOTA",
      400,
    )
  }

  const rootId = await resolveAccountRootId(companyId)
  const [existing, currentBranches, currentCompanies] = await Promise.all([
    prisma.subscription.findFirst({
      where: { companyId: rootId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    countAccountBranches(rootId),
    countAccountCompanies(rootId),
  ])

  // Verilmeyen kota alanına dokunulmaz (undefined → Prisma alanı atlar).
  const data = {
    ...(branchQuota != null ? { branchQuota } : {}),
    ...(companyQuota != null ? { companyQuota } : {}),
  }

  if (existing) {
    const updated = await prisma.subscription.update({
      where: { id: existing.id },
      data,
      select: { id: true, status: true, branchQuota: true, companyQuota: true },
    })
    return {
      rootId,
      subscriptionId: updated.id,
      status: updated.status,
      branchQuota: updated.branchQuota,
      companyQuota: updated.companyQuota,
      currentBranches,
      currentCompanies,
      createdSubscription: false,
    }
  }

  if (!opts.createTrialIfMissing) {
    throw new BillingAdminError(
      "Hesabın aboneliği yok; kota tek başına etkisiz kalır.",
      "NO_SUBSCRIPTION",
      409,
    )
  }

  const userId = await resolveAccountOwnerUserId(rootId)
  if (!userId) {
    throw new BillingAdminError("Firmada kullanıcı yok; abonelik oluşturulamadı", "NO_USER", 409)
  }

  const now = new Date()
  const trialEndsAt = new Date(now)
  trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1)
  const freePlan = await upsertTrialPlan()
  const created = await prisma.subscription.create({
    data: {
      userId,
      companyId: rootId,
      planId: freePlan.id,
      provider: "NONE",
      status: "TRIAL",
      branchQuota: branchQuota ?? 0,
      companyQuota: companyQuota ?? 0,
      trialEndsAt,
      periodStart: now,
      periodEnd: trialEndsAt,
    },
    select: { id: true, status: true, branchQuota: true, companyQuota: true },
  })

  return {
    rootId,
    subscriptionId: created.id,
    status: created.status,
    branchQuota: created.branchQuota,
    companyQuota: created.companyQuota,
    currentBranches,
    currentCompanies,
    createdSubscription: true,
  }
}
