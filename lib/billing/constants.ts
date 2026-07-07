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
 * her yönetilebilir modül + ek şube. Fiyatlar 0 başlar, admin belirler.
 */
export function defaultPricingItems(): Array<{ key: string; label: string; sortOrder: number }> {
  const items = MANAGEABLE_MODULES.map((m, i) => ({
    key: modulePriceKey(m.key),
    label: m.label,
    sortOrder: i,
  }))
  items.push({ key: BRANCH_ITEM_KEY, label: "Ek Şube", sortOrder: items.length })
  return items
}

/** Yönetilebilir tüm modül anahtarları (satılabilir modül evreni). */
export const ALL_MODULE_KEYS = MODULE_KEYS
