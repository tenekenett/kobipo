// Abonelik → yetki (entitlement) çözümü ve uygulanışı.
//
// Model: abonelik HESAP düzeyindedir (kök/ana firma). Seçilen modüller ana firma VE tüm
// şubeleri için geçerlidir. Uygulama mevcut modül gating'ini yeniden kullanır: satın alınan
// modüller `company.disabledModules`'a türetilmiş yazılır (disabled = TÜM − satın alınan),
// böylece menü gizleme / route guard / server context hiç değişmeden çalışır. Bkz. [[lib/modules.ts]].

import { prisma } from "@/lib/db/prisma"
import {
  DEFAULT_TRIAL_MODULE_KEYS,
  MODULE_KEYS,
  sanitizeDisabledModules,
  withModuleDependencies,
} from "@/lib/modules"
import type { BillingCycle } from "@/lib/billing/constants"

/**
 * Bir firmanın hesap kökünü (ana firma) döndürür. Şube ise parentCompanyId'ye çıkar;
 * ana firma ise kendisidir. (Şema tek seviye şube garantisi verir — zincir kurulamaz.)
 */
export async function resolveAccountRootId(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, parentCompanyId: true },
  })
  if (!company) return companyId
  return company.parentCompanyId ?? company.id
}

/** Hesabın (kök firma) en güncel aboneliğini döndürür. */
export async function getAccountSubscription(companyId: string) {
  const rootId = await resolveAccountRootId(companyId)
  return prisma.subscription.findFirst({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  })
}

/** Hesaptaki mevcut şube (alt firma) sayısı. */
export async function countAccountBranches(rootCompanyId: string): Promise<number> {
  return prisma.company.count({ where: { parentCompanyId: rootCompanyId } })
}

type SubStatusView = {
  status: string
  purchasedModules: string[]
  trialEndsAt: Date | null
  periodEnd: Date | null
}

/** Deneme aktif mi? (status TRIAL ve bitiş tarihi gelecekte / boş) */
export function isTrialActive(sub: SubStatusView | null | undefined, now = new Date()): boolean {
  if (!sub || sub.status !== "TRIAL") return false
  return !sub.trialEndsAt || sub.trialEndsAt.getTime() > now.getTime()
}

/** Ücretli abonelik aktif mi? (status ACTIVE ve dönem bitmemiş) */
export function isPaidActive(sub: SubStatusView | null | undefined, now = new Date()): boolean {
  if (!sub || sub.status !== "ACTIVE") return false
  return !sub.periodEnd || sub.periodEnd.getTime() > now.getTime()
}

/**
 * Aboneliğe göre efektif AÇIK modül anahtarları:
 * - Deneme aktifse → opt-in OLMAYAN tüm modüller. Sektörel modüller (ör. Restoran
 *   & Kafe) denemeye dahil DEĞİLDİR; aksi halde alakasız sektörlerdeki her deneme
 *   hesabına o menü çıkardı. Bkz. lib/modules.ts ModuleDef.optIn
 * - Ücretli aktifse → satın alınan modüller.
 * - Aksi halde (yok/expired/cancelled) → hiçbiri.
 *
 * Her iki durumda da modül bağımlılıkları tamamlanır (ör. restaurant → stock).
 */
export function resolveGrantedModules(sub: SubStatusView | null | undefined, now = new Date()): string[] {
  if (isTrialActive(sub, now)) return [...DEFAULT_TRIAL_MODULE_KEYS]
  if (isPaidActive(sub, now)) {
    return withModuleDependencies(sanitizeDisabledModules(sub!.purchasedModules))
  }
  return []
}

/**
 * Verilen açık modül setini hesabın ana firmasına VE tüm şubelerine uygular.
 * `company.disabledModules = TÜM − granted` yazar. Tek transaction.
 */
export async function applyEntitlements(rootCompanyId: string, grantedModules: string[]): Promise<void> {
  // Bağımlılıklar burada da tamamlanır: arayüz atlanıp bu fonksiyon doğrudan
  // çağrılsa bile DB'ye tutarsız bir küme (ör. restaurant açık, stock kapalı) yazılmasın.
  const granted = new Set(withModuleDependencies(sanitizeDisabledModules(grantedModules)))
  const disabled = MODULE_KEYS.filter((k) => !granted.has(k))

  await prisma.$transaction([
    prisma.company.update({
      where: { id: rootCompanyId },
      data: { disabledModules: disabled },
    }),
    prisma.company.updateMany({
      where: { parentCompanyId: rootCompanyId },
      data: { disabledModules: disabled },
    }),
  ])
}

/** Periyoda göre dönem bitiş tarihi (başlangıçtan +1 ay / +1 yıl). */
export function periodEndFor(cycle: BillingCycle, start = new Date()): Date {
  const end = new Date(start)
  if (cycle === "YEARLY") end.setFullYear(end.getFullYear() + 1)
  else end.setMonth(end.getMonth() + 1)
  return end
}
