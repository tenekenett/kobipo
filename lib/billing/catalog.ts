// Katalog yardımcıları: satılabilir paketler (bundle) ve à la carte fiyat öğeleri.

import { prisma } from "@/lib/db/prisma"
import { defaultPricingItems } from "@/lib/billing/constants"
import type { PricingMap } from "@/lib/billing/pricing"

/** İlk kayıtta oluşturulan deneme planının kodu — satılabilir listede gösterilmez. */
export const TRIAL_PLAN_CODE = "FREE_1Y"

/**
 * Admin panelinde her zaman görünmesi için varsayılan à la carte fiyat öğelerini
 * (her modül + ek şube) oluşturur. VAR OLANLARIN FİYATINI DEĞİŞTİRMEZ (create-only upsert).
 */
export async function ensureDefaultPricingItems(): Promise<void> {
  const defaults = defaultPricingItems()
  await prisma.$transaction(
    defaults.map((d) =>
      prisma.pricingItem.upsert({
        where: { key: d.key },
        create: { key: d.key, label: d.label, sortOrder: d.sortOrder },
        update: {}, // mevcutsa dokunma
      }),
    ),
  )
}

/** PricingItem kayıtlarını fiyat haritasına (Decimal → number) çevirir. */
export function toPricingMap(
  items: Array<{ key: string; monthlyPrice: unknown; yearlyPrice: unknown }>,
): PricingMap {
  const map: PricingMap = {}
  for (const it of items) {
    map[it.key] = {
      monthlyPrice: Number(it.monthlyPrice) || 0,
      yearlyPrice: Number(it.yearlyPrice) || 0,
    }
  }
  return map
}

/** Satılabilir paketler (deneme planı hariç). */
export async function getSellablePlans(includeInactive: boolean) {
  return prisma.plan.findMany({
    where: {
      code: { not: TRIAL_PLAN_CODE },
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { monthlyPrice: "asc" }],
  })
}
