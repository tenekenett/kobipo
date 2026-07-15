// Etiket Tasarımcısı — ürün alanı kayıt defteri ve değer çözümleme.
// Saf TS (React/DOM yok); hem DOM editörü (örnek değerlerle) hem PDF üretici
// (gerçek ürün verisiyle) aynı resolveFieldValue'yu kullanır → WYSIWYG.

import type {
  BarcodeElement,
  FieldElement,
  ProductFieldKey,
  QrElement,
} from "./types"

// PDF/önizleme render'ının ihtiyaç duyduğu minimal ürün verisi.
// Not: fiyatlar DB'de DAİMA net (KDV hariç) saklanır (bkz. prisma Product
// yorumu) — KDV dahil değer render sırasında vatRate ile hesaplanır.
export interface LabelProduct {
  id: string
  name: string
  code?: string | null
  barcode?: string | null
  salePrice?: number | null
  vatRate?: number | null
  unit?: string | null
  category?: string | null
  currency?: string | null // TRY | USD | EUR ...
}

export interface LabelCompanyInfo {
  name: string
}

export interface ProductFieldDef {
  key: ProductFieldKey
  label: string // toolbox buton etiketi (Türkçe)
  sample: string // editör canvas'ında gösterilen temsili değer
  isPrice?: boolean
}

export const PRODUCT_FIELDS: ProductFieldDef[] = [
  { key: "name", label: "Ürün Adı", sample: "Örnek Ürün Çeşidi 500g" },
  { key: "code", label: "Ürün Kodu", sample: "PRD-0001" },
  { key: "barcode", label: "Barkod No (yazı)", sample: "8690123456789" },
  { key: "salePrice", label: "Fiyat (KDV hariç)", sample: "₺124,50", isPrice: true },
  { key: "salePriceWithVat", label: "Fiyat (KDV dahil)", sample: "₺149,40", isPrice: true },
  { key: "unit", label: "Birim", sample: "ADET" },
  { key: "category", label: "Kategori", sample: "Genel" },
  { key: "companyName", label: "Firma Adı", sample: "Firma Ünvanı" },
  { key: "date", label: "Tarih", sample: "15.07.2026" },
]

// Editör canvas'ının alan öğelerini doldurmak için kullandığı temsili ürün.
// Barkod geçerli bir EAN-13'tür (checksum tutar) — editörde çubuklar çizilsin diye.
export const SAMPLE_PRODUCT: LabelProduct = {
  id: "sample",
  name: "Örnek Ürün Çeşidi 500g",
  code: "PRD-0001",
  barcode: "8690123456789",
  salePrice: 124.5,
  vatRate: 20,
  unit: "ADET",
  category: "Genel",
  currency: "TRY",
}

export const SAMPLE_COMPANY: LabelCompanyInfo = { name: "Firma Ünvanı" }

function currencyCode(currency: string | null | undefined): string {
  const c = (currency || "TRY").toUpperCase()
  return /^[A-Z]{3}$/.test(c) ? c : "TRY"
}

export function formatLabelPrice(
  value: number,
  opts: { decimals: number; showCurrency: boolean },
  currency: string | null | undefined
): string {
  if (!Number.isFinite(value)) return ""
  if (opts.showCurrency) {
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: currencyCode(currency),
        minimumFractionDigits: opts.decimals,
        maximumFractionDigits: opts.decimals,
      }).format(value)
    } catch {
      // geçersiz para kodu → sade sayı + kod
      return `${value.toFixed(opts.decimals)} ${currencyCode(currency)}`
    }
  }
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: opts.decimals,
    maximumFractionDigits: opts.decimals,
  }).format(value)
}

/** Alan öğesinin metnini üretir (prefix/suffix dahil). */
export function resolveFieldValue(
  el: FieldElement,
  product: LabelProduct,
  company: LabelCompanyInfo
): string {
  const priceOpts = el.price ?? { decimals: 2, showCurrency: true }
  let value: string
  switch (el.fieldKey) {
    case "name":
      value = product.name || ""
      break
    case "code":
      value = product.code || ""
      break
    case "barcode":
      value = product.barcode || ""
      break
    case "salePrice": {
      const v = Number(product.salePrice)
      value = Number.isFinite(v) ? formatLabelPrice(v, priceOpts, product.currency) : ""
      break
    }
    case "salePriceWithVat": {
      const net = Number(product.salePrice)
      const vat = Number(product.vatRate)
      const gross = Number.isFinite(net) ? net * (1 + (Number.isFinite(vat) ? vat : 0) / 100) : NaN
      value = Number.isFinite(gross) ? formatLabelPrice(gross, priceOpts, product.currency) : ""
      break
    }
    case "unit":
      value = product.unit || ""
      break
    case "category":
      value = product.category || ""
      break
    case "companyName":
      value = company.name || ""
      break
    case "date":
      value = new Intl.DateTimeFormat("tr-TR").format(new Date())
      break
    default:
      value = ""
  }
  return `${el.prefix ?? ""}${value}${el.suffix ?? ""}`
}

/** Barkod / QR öğesinin kodlanacak değerini üretir. */
export function resolveCodeValue(
  el: BarcodeElement | QrElement,
  product: LabelProduct
): string {
  switch (el.source) {
    case "barcode":
      return product.barcode || ""
    case "code":
      return product.code || ""
    case "name":
      return product.name || ""
    case "custom":
      return el.customValue || ""
    default:
      return ""
  }
}
