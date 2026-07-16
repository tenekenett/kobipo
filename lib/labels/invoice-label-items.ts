// Fatura kalemlerinden etiket basılabilir ürün listesi üretir.
// Saf TS (React/DOM yok). Hem fatura önizleme sayfası (buton görünürlüğü) hem de
// etiket yazdırma sayfası (panel verisi) aynı mantığı buradan kullanır.
//
// Kural: yalnız kataloğa bağlı (product'lı) ve hizmet olmayan kalemler etikete
// girer; aynı ürün birden fazla satırdaysa adetler birleştirilir. Adet, fatura
// miktarının yukarı yuvarlanmışıdır (etiket birim bazlıdır; kesirli miktarlar
// ör. 2,5 kg → 3 etiket önerilir).

import type { LabelProduct } from "./fields"

export interface InvoiceLabelItem {
  key: string // benzersiz satır anahtarı (ürün id)
  product: LabelProduct
  quantity: number // önerilen adet
}

// Prisma Decimal alanları JSON'da string olarak gelebilir → Number ile çevrilir.
export interface RawInvoiceLabelItem {
  unit?: string | null
  quantity: number | string
  product?: {
    id?: string
    name: string
    code?: string | null
    barcode?: string | null
    salePrice?: number | string | null
    vatRate?: number | string | null
    unit?: string | null
    category?: string | null
    currency?: string | null
    isService?: boolean
  } | null
}

export function buildInvoiceLabelItems(items: RawInvoiceLabelItem[]): InvoiceLabelItem[] {
  const byProduct = new Map<string, InvoiceLabelItem>()
  for (const item of items) {
    const p = item.product
    if (!p || !p.id || p.isService) continue
    const qty = Math.max(1, Math.ceil(Number(item.quantity) || 0))
    const existing = byProduct.get(p.id)
    if (existing) {
      existing.quantity += qty
      continue
    }
    const product: LabelProduct = {
      id: p.id,
      name: p.name,
      code: p.code ?? null,
      barcode: p.barcode ?? null,
      salePrice: p.salePrice != null ? Number(p.salePrice) : null,
      vatRate: p.vatRate != null ? Number(p.vatRate) : null,
      unit: p.unit ?? item.unit ?? null,
      category: p.category ?? null,
      currency: p.currency ?? null,
    }
    byProduct.set(p.id, { key: p.id, product, quantity: qty })
  }
  return [...byProduct.values()]
}
