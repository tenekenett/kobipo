// Ürün seçeneği (porsiyon / modifier) ortak yardımcıları.
// Kararlar: docs/restoran/SATIS-EKRANI.md K6.
//
// `priceDelta` KDV DAHİL tutulur: kullanıcı menüdeki fiyat gibi düşünür
// ("büyük boy +15 lira"). Adisyon kalemine yazılırken net'e çevrilir — bu
// çevrim tek yerde, kalem ekleme ucunda yapılır.
//
// Seçeneğin REÇETEYE etkisi de burada tanımlanır (değişim / ekleme / porsiyon
// çarpanı). Etkinin stoğa nasıl uygulandığı: lib/stock/recipe-expand.ts.

import { Prisma } from "@prisma/client"
import { normalizeUnitCode } from "@/lib/data/units"
import type { prisma } from "@/lib/db/prisma"

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
      // Reçete etkisi (K6). Ekran bunu hem kurulumda düzenler hem de satışta
      // "yetersiz stok" uyarısını doğru hesaplamak için okur.
      effectMode: o.effectMode,
      fromProductId: o.fromProductId,
      toProductId: o.toProductId,
      effectQuantity: o.effectQuantity != null ? Number(o.effectQuantity) : null,
      effectUnit: o.effectUnit,
      recipeFactor: o.recipeFactor != null ? Number(o.recipeFactor) : null,
    })),
  }
}

export type OptionGroupView = ReturnType<typeof serializeOptionGroup>

export type NormalizedOption = {
  name: string
  priceDelta: number
  isDefault: boolean
  order: number
  effectMode: string | null
  fromProductId: string | null
  toProductId: string | null
  effectQuantity: number | null
  effectUnit: string | null
  recipeFactor: number | null
}

/**
 * İstemciden gelen şık listesini temizler: adsız şık atılır, sıra normalize
 * edilir, tek seçimli grupta birden çok varsayılan olamaz (ilki kalır).
 *
 * Reçete etkisi de burada temizlenir; ÜRÜN SAHİPLİĞİ burada doğrulanamaz
 * (DB gerekir) — onu çağıran uç `optionEffectProductIds` ile yapar.
 */
export function normalizeOptionInput(raw: unknown): NormalizedOption[] {
  if (!Array.isArray(raw)) return []
  let defaultSeen = false
  return raw
    .map((o: any) => ({
      name: String(o?.name ?? "").trim().slice(0, 80),
      priceDelta: Number.isFinite(Number(o?.priceDelta)) ? Number(o.priceDelta) : 0,
      isDefault: o?.isDefault === true,
      ...normalizeEffect(o),
    }))
    .filter((o) => o.name)
    .map((o, index) => {
      const isDefault = o.isDefault && !defaultSeen
      if (isDefault) defaultSeen = true
      return { ...o, isDefault, order: index }
    })
}

/**
 * Reçete etkisini temizler. Yarım kalan tanım KAYDEDİLMEZ (mod null'a düşer):
 * hedefi olmayan bir "ekleme" ya da kaynağı olmayan bir "değişim" satışta
 * sessizce yok sayılırdı; kullanıcı menüde tanımlı sanırdı.
 */
function normalizeEffect(raw: any): {
  effectMode: string | null
  fromProductId: string | null
  toProductId: string | null
  effectQuantity: number | null
  effectUnit: string | null
  recipeFactor: number | null
} {
  const empty = {
    effectMode: null,
    fromProductId: null,
    toProductId: null,
    effectQuantity: null,
    effectUnit: null,
  }

  // Porsiyon çarpanı moddan BAĞIMSIZ: "büyük boy" hem reçeteyi ölçekleyip hem
  // de bir bileşeni değiştirebilir. 1 (ve bozuk değer) etkisiz sayılır.
  const factorRaw = Number(raw?.recipeFactor)
  const recipeFactor =
    Number.isFinite(factorRaw) && factorRaw > 0 && factorRaw !== 1
      ? Math.min(Math.round(factorRaw * 1000) / 1000, 100)
      : null

  const mode = String(raw?.effectMode ?? "").trim().toUpperCase()
  const fromProductId = raw?.fromProductId ? String(raw.fromProductId) : null
  const toProductId = raw?.toProductId ? String(raw.toProductId) : null

  if (mode === "SWAP") {
    // Hedefsiz değişim geçerlidir: "şekersiz" = bileşeni çıkar.
    if (!fromProductId) return { ...empty, recipeFactor }
    return {
      effectMode: "SWAP",
      fromProductId,
      toProductId,
      effectQuantity: null,
      effectUnit: null,
      recipeFactor,
    }
  }

  if (mode === "ADD") {
    const quantity = Number(String(raw?.effectQuantity ?? "").toString().replace(",", "."))
    const unit = normalizeUnitCode(raw?.effectUnit)
    if (!toProductId || !Number.isFinite(quantity) || quantity <= 0 || !unit) {
      return { ...empty, recipeFactor }
    }
    return {
      effectMode: "ADD",
      fromProductId: null,
      toProductId,
      effectQuantity: quantity,
      effectUnit: unit,
      recipeFactor,
    }
  }

  return { ...empty, recipeFactor }
}

/** Etkilerde geçen ürün id'leri — uç, firmaya ait olduklarını doğrular. */
export function optionEffectProductIds(options: NormalizedOption[]): string[] {
  const ids = new Set<string>()
  for (const option of options) {
    if (option.fromProductId) ids.add(option.fromProductId)
    if (option.toProductId) ids.add(option.toProductId)
  }
  return Array.from(ids)
}

/**
 * Etkide geçen ürünler bu firmaya mı ait?
 *
 * Yalnız "var mı" değil "BU firmanın mı" diye sorar: aksi halde bir kullanıcı
 * başka firmanın ürün id'sini yazıp o kartın adını/varlığını sızdırabilirdi.
 * Uymayan id varsa kullanıcıya gösterilecek hata metni döner, yoksa null.
 */
export async function checkOptionEffectProducts(
  db: Pick<typeof prisma, "product">,
  companyId: string,
  options: NormalizedOption[],
): Promise<string | null> {
  const ids = optionEffectProductIds(options)
  if (ids.length === 0) return null

  const found = await db.product.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true },
  })
  if (found.length === ids.length) return null
  return "Reçete etkisinde geçersiz ürün var"
}
