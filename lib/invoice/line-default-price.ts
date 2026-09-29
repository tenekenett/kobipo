/**
 * Faturada ürün seçilince satırın ÖN-DOLU birim fiyatı (saf; editör istemcide çağırır).
 *
 * Belgenin YÖNÜNE göre seçilir: satış tarafında ürünün satış fiyatı, alış tarafında
 * (alış faturası, alış iadesi) ALIŞ fiyatı. 2026-09-29'a kadar editör her tipte satış
 * fiyatını dolduruyordu: kullanıcı fark etmeden kaydettiği alış faturası ürünü satış
 * fiyatından stoğa sokuyor, maliyet (AVCO) ve dolayısıyla kâr şişiyordu.
 *
 * Alışta kart fiyatı yoksa ağırlıklı ortalama maliyete (`avgPurchasePrice`, ürün listesi
 * ucu verir) düşülür; o da yoksa 0 — satış fiyatına ASLA düşülmez, boş kutu kullanıcıya
 * fiyatı girmesi gerektiğini söyler.
 */

export type PriceSide = "sale" | "purchase"

type PricedProduct = {
  salePrice?: unknown
  purchasePrice?: unknown
  avgPurchasePrice?: unknown
}

const positive = (v: unknown): number | null => {
  const n = Number(v)
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null
}

export function priceSideFor(type: string, returnKind?: string | null): PriceSide {
  const t = String(type || "").toUpperCase()
  if (t === "PURCHASE") return "purchase"
  if (t === "RETURN" && String(returnKind || "").toUpperCase() === "PURCHASE") return "purchase"
  return "sale"
}

export function defaultLineUnitPrice(product: PricedProduct, side: PriceSide): number {
  if (side === "purchase") return positive(product.purchasePrice) ?? positive(product.avgPurchasePrice) ?? 0
  return positive(product.salePrice) ?? 0
}
