/**
 * Belge formlarından (teklif/sipariş/irsaliye) hızlı ürün oluşturma yardımcısı.
 * /api/stok/products POST'una en az companyId + name gönderir; isteğe bağlı
 * fiyat/birim alanları kataloğa kaydedilir. Dönen ürünü sayısallaştırarak verir
 * (Decimal alanlar string gelebilir).
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
  }
}
