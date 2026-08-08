// Abonelik → yetki (entitlement) çözümü ve uygulanışı.
//
// Model: abonelik HESAP düzeyindedir (kök/ana firma). Seçilen modüller ana firma VE tüm
// şubeleri için geçerlidir. Uygulama mevcut modül gating'ini yeniden kullanır: satın alınan
// modüller `company.disabledModules`'a türetilmiş yazılır (disabled = TÜM − satın alınan),
// böylece menü gizleme / route guard / server context hiç değişmeden çalışır. Bkz. [[lib/modules.ts]].

import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS, sanitizeDisabledModules, withModuleDependencies } from "@/lib/modules"
import { GRACE_PERIOD_DAYS, type BillingCycle } from "@/lib/billing/constants"
import { DAY_MS } from "@/lib/billing/notice"

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
 * Ödeme alınamadı ama hoşgörü süresi dolmadı → erişim SÜRÜYOR.
 *
 * `PAST_DUE`'yu ayrı bir "yarı açık" durum olarak görmek şart: aksi halde yetkiler her
 * yeniden hesaplandığında (reconcile, recurring, admin) hoşgörü süresindeki müşteri
 * anında kilitlenirdi. Bkz. [[lib/billing/constants.ts]] → GRACE_PERIOD_DAYS.
 */
export function isInGracePeriod(sub: SubStatusView | null | undefined, now = new Date()): boolean {
  if (!sub || sub.status !== "PAST_DUE" || !sub.periodEnd) return false
  return sub.periodEnd.getTime() + GRACE_PERIOD_DAYS * DAY_MS > now.getTime()
}

/**
 * Aboneliğe göre efektif AÇIK modül anahtarları:
 * - Ücretli aktifse VEYA hoşgörü süresindeyse → satın alınan modüller (bağımlılıklarıyla,
 *   ör. restaurant → stock).
 * - Aksi halde (deneme/yok/expired/cancelled/hoşgörüsü dolmuş) → hiçbiri.
 *
 * Modül YALNIZCA satın almayla açılır — deneme modül vermez. Deneme kavramı
 * ölmedi, kapsamı daraldı: `isTrialActive` hâlâ şube kotası için okunur
 * (bkz. app/api/companies/route.ts), ama modül yetkisi üretmez.
 */
export function resolveGrantedModules(sub: SubStatusView | null | undefined, now = new Date()): string[] {
  if (isPaidActive(sub, now) || isInGracePeriod(sub, now)) {
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
