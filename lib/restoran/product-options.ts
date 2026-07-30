// Ürün seçeneği (porsiyon / modifier) ortak yardımcıları.
// Kararlar: docs/restoran/SATIS-EKRANI.md K6.
//
// `priceDelta` KDV DAHİL tutulur: kullanıcı menüdeki fiyat gibi düşünür
// ("büyük boy +15 lira"). Adisyon kalemine yazılırken net'e çevrilir — bu
// çevrim tek yerde, kalem ekleme ucunda yapılır.

import { Prisma } from "@prisma/client"

export { assertRestaurantModule } from "@/lib/restoran/tickets"

export const optionGroupInclude = Prisma.validator<Prisma.ProductOptionGroupInclude>()({
  options: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
})

type GroupWithOptions = Prisma.ProductOptionGroupGetPayload<{ include: typeof optionGroupInclude }>

export function serializeOptionGroup(group: GroupWithOptions) {
  return {
    id: group.id,
    productId: group.productId,
    name: group.name,
    isRequired: group.isRequired,
    isMulti: group.isMulti,
    order: group.order,
    options: group.options.map((o) => ({
      id: o.id,
      name: o.name,
      priceDelta: Number(o.priceDelta),
      isDefault: o.isDefault,
      order: o.order,
    })),
  }
}

export type OptionGroupView = ReturnType<typeof serializeOptionGroup>

/**
 * İstemciden gelen şık listesini temizler: adsız şık atılır, sıra normalize
 * edilir, tek seçimli grupta birden çok varsayılan olamaz (ilki kalır).
 */
export function normalizeOptionInput(
  raw: unknown,
): Array<{ name: string; priceDelta: number; isDefault: boolean; order: number }> {
  if (!Array.isArray(raw)) return []
  let defaultSeen = false
  return raw
    .map((o: any) => ({
      name: String(o?.name ?? "").trim().slice(0, 80),
      priceDelta: Number.isFinite(Number(o?.priceDelta)) ? Number(o.priceDelta) : 0,
      isDefault: o?.isDefault === true,
    }))
    .filter((o) => o.name)
    .map((o, index) => {
      const isDefault = o.isDefault && !defaultSeen
      if (isDefault) defaultSeen = true
      return { ...o, isDefault, order: index }
    })
}
