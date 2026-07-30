/**
 * Ürün listesi dışa aktarımı.
 *
 * Filtreler `/stok` ekranındakilerle BİREBİR aynı kuralları uygular — tür
 * (`matchesKindFilter`), kategori, depo, düşük stok. Ekranın filtresi burada
 * yaklaşık olarak taklit edilseydi kullanıcı "listede 42 ürün var ama Excel'de
 * 47 çıktı" derdi ve hangisinin doğru olduğu belli olmazdı.
 */

import { prisma } from "@/lib/db/prisma"
import { resolveAllUnitCosts } from "@/lib/stock/cost"
import { matchesKindFilter, productKindOf, type ProductKind } from "@/lib/stock/product-kind"
import type { ExportColumn, ExportDataset } from "../types"
import { loadExportCompany, describeFilters } from "./context"

export type ProductExportParams = {
  companyId: string
  search?: string | null
  category?: string | null
  /** "menu" | "ingredient" | "both" | "service" — /stok ekranının tür süzgeci. */
  kind?: string | null
  /** Depo id'si; verilirse yalnızca o depoda stoğu olan ürünler ve o deponun miktarı. */
  warehouseId?: string | null
  /** "1"/"true" → yalnızca kritik/tükenmiş (reçeteli ürünler hariç). */
  lowStock?: string | null
  /** Eski `/api/export` uyumu için ham bayrak süzgeçleri. */
  isService?: string | null
  isSellable?: string | null
  isIngredient?: string | null
}

const KINDS: ProductKind[] = ["menu", "ingredient", "both", "service"]

const KIND_LABELS: Record<ProductKind, string> = {
  menu: "Ürün / Menü",
  ingredient: "Hammadde",
  both: "Ürün + Hammadde",
  service: "Hizmet",
}

function baseColumns(showWarehouse: boolean): ExportColumn[] {
  const columns: ExportColumn[] = [
    { key: "code", label: "Kod", width: 22 },
    { key: "name", label: "Ürün Adı" },
    { key: "barcode", label: "Barkod", width: 26 },
    { key: "category", label: "Kategori", width: 26 },
    { key: "unit", label: "Birim", width: 14, align: "center" },
    { key: "stockQuantity", label: showWarehouse ? "Depo Stoğu" : "Stok", type: "qty", width: 20 },
    { key: "minStockLevel", label: "Min. Stok", type: "qty", width: 18 },
    { key: "purchasePrice", label: "Alış Fiyatı", type: "money", width: 20 },
    { key: "avgPurchasePrice", label: "Ort. Maliyet", type: "money", width: 20 },
    { key: "salePrice", label: "Satış Fiyatı", type: "money", width: 20 },
    { key: "currency", label: "Döviz", width: 14, align: "center" },
    { key: "vatRate", label: "KDV", type: "percent", width: 14 },
    { key: "stockValue", label: "Stok Değeri", type: "money", width: 24, total: true },
    { key: "kindLabel", label: "Tür", width: 22 },
    { key: "isActive", label: "Aktif", type: "boolean", width: 14, align: "center" },
  ]
  return columns
}

function isTruthyFlag(value: string | null | undefined): boolean {
  return value === "1" || value === "true"
}

export async function buildProductsDataset(params: ProductExportParams): Promise<ExportDataset> {
  const where: any = { companyId: params.companyId }

  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { code: { contains: params.search, mode: "insensitive" } },
      { barcode: { contains: params.search, mode: "insensitive" } },
    ]
  }
  // Eski `/api/export` uyumu — yeni ekranlar `kind` gönderiyor.
  if (params.isService === "true" || params.isService === "false") where.isService = params.isService === "true"
  if (params.isSellable === "true" || params.isSellable === "false") where.isSellable = params.isSellable === "true"
  if (params.isIngredient === "true" || params.isIngredient === "false") {
    where.isIngredient = params.isIngredient === "true"
  }
  if (params.category) where.category = params.category

  const warehouseId = params.warehouseId && params.warehouseId !== "ALL" ? params.warehouseId : null

  const [company, products, costByProduct, warehouseStocks, recipes, warehouse] = await Promise.all([
    loadExportCompany(params.companyId),
    prisma.product.findMany({ where, orderBy: { name: "asc" } }),
    // Ağırlıklı ortalama alış fiyatı (AVCO) — tanım tek yerde: lib/stock/cost.ts.
    resolveAllUnitCosts(params.companyId),
    warehouseId
      ? prisma.warehouseStock.findMany({
          where: { warehouseId, warehouse: { companyId: params.companyId } },
          select: { productId: true, quantity: true },
        })
      : Promise.resolve([]),
    // Reçeteli ürünün bakiyesi hiç değişmediği için "tükendi" sayılamaz — düşük
    // stok süzgecinden dışarıda tutulur (ekranla aynı kural).
    prisma.productRecipe.findMany({
      where: { companyId: params.companyId },
      select: { productId: true },
    }),
    warehouseId
      ? prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } })
      : Promise.resolve(null),
  ])

  const warehouseQty = new Map(warehouseStocks.map((row) => [row.productId, Number(row.quantity)]))
  const recipeProductIds = new Set(recipes.map((row) => row.productId))

  const kindFilter = KINDS.includes(params.kind as ProductKind) ? (params.kind as ProductKind) : null
  const lowStockOnly = isTruthyFlag(params.lowStock)

  const filtered = products.filter((product) => {
    if (warehouseId && !warehouseQty.has(product.id)) return false
    if (kindFilter && !matchesKindFilter(product, kindFilter)) return false
    if (lowStockOnly) {
      if (recipeProductIds.has(product.id)) return false
      if (product.isService) return false
      const quantity = Number(product.stockQuantity)
      const isOut = quantity <= 0
      const isLow = product.minStockLevel !== null && quantity <= Number(product.minStockLevel)
      if (!isOut && !isLow) return false
    }
    return true
  })

  const rows = filtered.map((product) => {
    const avgCost = costByProduct.get(product.id) ?? null
    // Stok değeri ortalama maliyetten; o yoksa kartın alış fiyatından. Hizmetin
    // stoğu yok, değeri de olmamalı.
    const unitCost = avgCost ?? (product.purchasePrice === null ? null : Number(product.purchasePrice))
    const quantity = warehouseId ? warehouseQty.get(product.id) ?? 0 : Number(product.stockQuantity)
    return {
      code: product.code,
      name: product.name,
      barcode: product.barcode,
      category: product.category,
      unit: product.unit,
      stockQuantity: product.isService ? null : quantity,
      minStockLevel: product.minStockLevel,
      purchasePrice: product.purchasePrice,
      avgPurchasePrice: avgCost,
      salePrice: product.salePrice,
      currency: product.currency,
      vatRate: product.vatRate,
      stockValue: product.isService || unitCost === null ? null : quantity * unitCost,
      kindLabel: KIND_LABELS[productKindOf(product)],
      isActive: product.isActive,
    }
  })

  return {
    title: "Ürün Listesi",
    company,
    filters: describeFilters([
      ["Arama", params.search],
      ["Kategori", params.category],
      ["Tür", kindFilter ? KIND_LABELS[kindFilter] : null],
      ["Depo", warehouse?.name],
      ["Stok", lowStockOnly ? "Yalnızca düşük stok" : null],
    ]),
    sections: [
      { title: "Ürünler", sheetName: "Ürünler", columns: baseColumns(Boolean(warehouseId)), rows },
    ],
    generatedAt: new Date(),
  }
}
