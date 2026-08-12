/**
 * Belge formlarından (teklif/sipariş/irsaliye) ve Menü & Reçeteler ekranından
 * hızlı ürün oluşturma yardımcısı. /api/stok/products POST'una en az
 * companyId + name gönderir; isteğe bağlı alanlar kataloğa kaydedilir. Dönen
 * ürünü sayısallaştırarak verir (Decimal alanlar string gelebilir).
 *
 * Menü ekranı bunu iki şekilde kullanır:
 *  - menü ürünü  → isSellable: true  (+ ardından reçetesi kurulur)
 *  - hammadde    → isSellable: false (menüde/hızlı satışta listelenmez)
 * Böylece kullanıcı menü kurmak için Stok ekranına gitmek zorunda kalmıyor;
 * ürün kartı reçeteyle BİRLİKTE doğuyor. Bkz. docs/restoran/SADELESTIRME.md "İş 7".
 */
export type CreatedProduct = {
  id: string
  name: string
  code?: string | null
  salePrice?: number | null
  purchasePrice?: number | null
  unit?: string | null
  vatRate?: number | null
  isService?: boolean
  isSellable?: boolean
  isIngredient?: boolean
  category?: string | null
  imageUrl?: string | null
}

export async function quickCreateProduct(input: {
  companyId: string
  name: string
  code?: string | null
  salePrice?: string | number | null
  purchasePrice?: string | number | null
  unit?: string | null
  vatRate?: string | number | null
  isService?: boolean
  /** Menüde/hızlı satışta listelensin mi. Gönderilmezse sunucu true kabul eder. */
  isSellable?: boolean
  /** Reçete bileşeni mi. isSellable ile birbirini DIŞLAMAZ; varsayılan false. */
  isIngredient?: boolean
  /** Menü sekmesi kategorisi (serbest metin). */
  category?: string | null
  /**
   * Ürün fotoğrafı — ÖNCE /api/stok/products/image ucuna yüklenip dönen URL.
   * Sunucu yalnızca kendi bucket'ımızdaki adresi kabul eder.
   */
  imageUrl?: string | null
  /** Kritik stok seviyesi — hammaddelerde uyarı paneli bunu kullanır. */
  minStockLevel?: string | number | null
  /** Açılış stoğu; sunucu depo bazlı hareketle işler. */
  stockQuantity?: string | number | null
  /** Fiyat KDV dahil girildiyse true — sunucu net'e çevirip öyle saklar. */
  salePriceVatIncluded?: boolean
  purchasePriceVatIncluded?: boolean
}): Promise<CreatedProduct> {
  const name = input.name.trim()
  if (!name) throw new Error("Ürün adı boş olamaz")

  const res = await fetch("/api/stok/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: input.companyId,
      name,
      code: input.code?.toString().trim() || undefined,
      salePrice: input.salePrice ?? undefined,
      purchasePrice: input.purchasePrice ?? undefined,
      unit: input.unit ?? undefined,
      vatRate: input.vatRate ?? undefined,
      isService: input.isService ?? undefined,
      isSellable: input.isSellable ?? undefined,
      isIngredient: input.isIngredient ?? undefined,
      category: input.category ?? undefined,
      imageUrl: input.imageUrl ?? undefined,
      minStockLevel: input.minStockLevel ?? undefined,
      stockQuantity: input.stockQuantity ?? undefined,
      salePriceVatIncluded: input.salePriceVatIncluded ?? undefined,
      purchasePriceVatIncluded: input.purchasePriceVatIncluded ?? undefined,
    }),
  })

  const data = await res.json().catch(() => ({}) as any)
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Ürün eklenemedi")
  }

  return {
    id: data.id,
    name: data.name,
    code: data.code ?? null,
    salePrice: data.salePrice != null ? Number(data.salePrice) : null,
    purchasePrice: data.purchasePrice != null ? Number(data.purchasePrice) : null,
    unit: data.unit ?? null,
    vatRate: data.vatRate != null ? Number(data.vatRate) : null,
    isService: Boolean(data.isService),
    isSellable: data.isSellable !== false,
    isIngredient: data.isIngredient === true,
    category: data.category ?? null,
  }
}
