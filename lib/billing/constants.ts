// Paket/abonelik sisteminin ortak sabitleri ve yardımcıları.
// Modül kataloğu için tek kaynak: [[lib/modules.ts]] (MANAGEABLE_MODULES).

import { MANAGEABLE_MODULES, MODULE_KEYS } from "@/lib/modules"

export type BillingCycle = "MONTHLY" | "YEARLY"
export const BILLING_CYCLES: BillingCycle[] = ["MONTHLY", "YEARLY"]

export function isBillingCycle(v: unknown): v is BillingCycle {
  return v === "MONTHLY" || v === "YEARLY"
}

/** À la carte ek şube kotası fiyat öğesinin anahtarı (PricingItem.key). */
export const BRANCH_ITEM_KEY = "branch"

/**
 * À la carte ek FİRMA kotası fiyat öğesinin anahtarı (PricingItem.key).
 *
 * Şubeden ayrı bir üründür ve ayrı bir sayaçtır: şube aynı tüzel kişinin ikinci
 * adresidir (VKN ortak), ek firma ayrı VKN'li bir tüzel kişidir — yalnızca abonelik
 * ve modüller hesap kökünden akar. Bkz. prisma → Company.accountRootId.
 */
export const COMPANY_ITEM_KEY = "company"

/** Elle verilebilen şube kotası üst sınırı (sistem-admin) — yanlış girişe karşı emniyet. */
export const MAX_BRANCH_QUOTA = 999

/** Elle verilebilen firma kotası üst sınırı (sistem-admin). */
export const MAX_COMPANY_QUOTA = 999

/** Bir modül anahtarını PricingItem anahtarına çevirir (ör. "sales" → "module:sales"). */
export function modulePriceKey(moduleKey: string): string {
  return `module:${moduleKey}`
}

/** PricingItem anahtarından modül anahtarını çıkarır (module: değilse null). */
export function moduleKeyFromPriceKey(itemKey: string): string | null {
  return itemKey.startsWith("module:") ? itemKey.slice("module:".length) : null
}

/**
 * Admin panelinde her zaman görünmesi gereken varsayılan à la carte fiyat öğeleri:
 * her yönetilebilir modül + ek şube + ek firma. Fiyatlar 0 başlar, admin belirler.
 */
export function defaultPricingItems(): Array<{ key: string; label: string; sortOrder: number }> {
  const items = MANAGEABLE_MODULES.map((m, i) => ({
    key: modulePriceKey(m.key),
    label: m.label,
    sortOrder: i,
  }))
  items.push({ key: BRANCH_ITEM_KEY, label: "Ek Şube", sortOrder: items.length })
  items.push({ key: COMPANY_ITEM_KEY, label: "Ek Firma", sortOrder: items.length })
  return items
}

/** Yönetilebilir tüm modül anahtarları (satılabilir modül evreni). */
export const ALL_MODULE_KEYS = MODULE_KEYS

/**
 * Ödeme alınamadıktan sonra erişimin açık kaldığı hoşgörü süresi (gün), PERİYODA GÖRE.
 *
 * Neden var: dönem bitiminde anında kilitlemek, kartı bir gün geç yenileyen ya da
 * bankası çekimi reddeden müşteriyi kapının dışında bırakır. Bu sürede abonelik
 * `PAST_DUE` durumunda bekler, modüller AÇIK kalır ([[lib/billing/entitlements.ts]] →
 * `isInGracePeriod`), uyarı e-postası ve panel şeridi devrededir. Süre dolunca
 * `reconcile` `EXPIRED` yazar ve modüller kapanır.
 *
 * Neden periyoda göre: yıllık ödeyen müşteri yılda bir kez, çoğu zaman muhasebe/onay
 * süreciyle öder — bir haftalık pencere kurumsal bir alıcı için gerçekçi değil. Aylık
 * ödeyende ise uzun hoşgörü bedava bir ay demektir. Bu yüzden aylık 7, yıllık 15 gün.
 *
 * İSTİSNA: kullanıcı dönem sonunda iptali kendisi istediyse (`cancelAtPeriodEnd`)
 * hoşgörü uygulanmaz — kapanacağını zaten biliyor.
 */
export const GRACE_DAYS_BY_CYCLE: Record<BillingCycle, number> = {
  MONTHLY: 7,
  YEARLY: 15,
}

/**
 * Periyodu bilinmeyen abonelikte kullanılan hoşgörü.
 *
 * UZUN olanı seçiyoruz (yıllık). `billingCycle` bugün her ücretli abonelikte dolu
 * (`activateSubscription` daima yazıyor); boş olması eski ya da elle açılmış bir
 * satır demektir. Böyle bir satırda kısa süreyi varsaymak, yıllık ödemiş bir müşteriyi
 * 8 gün erken kapı dışında bırakma riski taşır; uzun süreyi varsaymanın maliyeti ise
 * aylık bir müşteriye 8 gün fazladan erişimdir. İkisi arasında ikincisi tercih edilir.
 */
export const DEFAULT_GRACE_DAYS = GRACE_DAYS_BY_CYCLE.YEARLY

/** Bir aboneliğin hoşgörü süresi (gün). Periyot bilinmiyorsa `DEFAULT_GRACE_DAYS`. */
export function graceDaysFor(cycle: unknown): number {
  return isBillingCycle(cycle) ? GRACE_DAYS_BY_CYCLE[cycle] : DEFAULT_GRACE_DAYS
}
