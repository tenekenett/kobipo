"use client"

// Firma kapsamlı referans veriler için SWR hook'ları.
// Amaç: aynı veriyi (ürün, cari, hesap, depo, kategori) her ekranda/mount'ta
// yeniden çekmek yerine URL anahtarıyla önbelleklemek ve dedupe etmek.
// companyId null iken anahtar null olur → SWR fetch atmaz (firma seçilene kadar bekler).

import { useMemo } from "react"
import useSWR from "swr"
import { jsonFetcher } from "./fetcher"
import {
  DEFAULT_RECEIPT_TEMPLATE,
  normalizeReceiptTemplate,
  type ReceiptTemplate,
} from "@/lib/fis/receipt-template"
import type { ReceiptCompanyInfo } from "@/lib/fis/receipt-html"
import { buildRecipeMap, type RecipeRecord } from "@/lib/stock/recipe-expand"

export type RefProduct = {
  id: string
  name: string
  code?: string | null
  barcode?: string | null
  salePrice: number | null
  purchasePrice: number | null
  /** Ağırlıklı ortalama alış (AVCO); yoksa purchasePrice'a düşer (API hesaplar). */
  avgPurchasePrice: number | null
  vatRate: number
  unit?: string | null
  category?: string | null
  currency?: string | null
  stockQuantity?: number
  minStockLevel?: number | null
  isService?: boolean
  /** Menüde/satışta listelenir mi. Bkz. docs/restoran/PLAN.md "Adım 2". */
  isSellable: boolean
  /** Reçete bileşeni mi. isSellable ile birbirini DIŞLAMAZ (paket kahve çekirdeği ikisi de). */
  isIngredient: boolean
  isActive: boolean
}
export type RefCounterparty = {
  id: string
  name: string
  /** Takma ad — cari seçicide ünvanın altında görünür ve aramada eşleşir. */
  nickname?: string | null
  taxNumber?: string | null
}
export type RefAccount = { id: string; name: string; type: string }
export type RefWarehouse = { id: string; name: string; isDefault?: boolean }
export type RefWarehouseStock = { warehouseId: string; productId: string; quantity: number }

const companyKey = (companyId: string | null, path: string, extra = "") =>
  companyId ? `${path}?companyId=${companyId}${extra}` : null

export function useProducts(companyId: string | null, opts?: { isService?: boolean }) {
  const key = companyKey(companyId, "/api/stok/products", opts?.isService === false ? "&isService=false" : "")
  const { data, error, isLoading, mutate } = useSWR<any[]>(key, jsonFetcher)
  const products = useMemo<RefProduct[]>(
    () =>
      (Array.isArray(data) ? data : []).map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code ?? null,
        barcode: p.barcode ?? null,
        salePrice: p.salePrice != null ? Number(p.salePrice) : null,
        purchasePrice: p.purchasePrice != null ? Number(p.purchasePrice) : null,
        avgPurchasePrice: p.avgPurchasePrice != null ? Number(p.avgPurchasePrice) : null,
        vatRate: Number(p.vatRate) || 20,
        unit: p.unit ?? null,
        category: p.category ?? null,
        currency: p.currency ?? null,
        stockQuantity: p.stockQuantity != null ? Number(p.stockQuantity) : undefined,
        minStockLevel: p.minStockLevel != null ? Number(p.minStockLevel) : null,
        isService: Boolean(p.isService),
        // Şema varsayılanı true; alan gelmezse eski davranış (her ürün satılabilir).
        isSellable: p.isSellable !== false,
        isIngredient: p.isIngredient === true,
        isActive: p.isActive !== false,
      })),
    [data]
  )
  return { products, isLoading, error, mutate }
}

// customers/suppliers aynı yanıt şeklini paylaşır (dizi veya { items }).
function useCounterparties(companyId: string | null, path: string) {
  const key = companyKey(companyId, path)
  const { data, error, isLoading, mutate } = useSWR<any>(key, jsonFetcher)
  const list = useMemo<RefCounterparty[]>(() => {
    const items = Array.isArray(data) ? data : data?.items ?? []
    return items.map((c: any) => ({
      id: c.id,
      name: c.name,
      nickname: c.nickname ?? null,
      taxNumber: c.taxNumber ?? null,
    }))
  }, [data])
  return { list, isLoading, error, mutate }
}

export function useCustomers(companyId: string | null) {
  const { list, ...rest } = useCounterparties(companyId, "/api/cari/customers")
  return { customers: list, ...rest }
}

export function useSuppliers(companyId: string | null) {
  const { list, ...rest } = useCounterparties(companyId, "/api/cari/suppliers")
  return { suppliers: list, ...rest }
}

export function useAccounts(companyId: string | null) {
  const key = companyKey(companyId, "/api/finans/accounts")
  const { data, error, isLoading, mutate } = useSWR<any[]>(key, jsonFetcher)
  const accounts = useMemo<RefAccount[]>(
    () => (Array.isArray(data) ? data : []).map((a) => ({ id: a.id, name: a.name, type: a.type })),
    [data]
  )
  return { accounts, isLoading, error, mutate }
}

export function useWarehouses(companyId: string | null) {
  const key = companyKey(companyId, "/api/depolar")
  const { data, error, isLoading, mutate } = useSWR<any[]>(key, jsonFetcher)
  const warehouses = useMemo<RefWarehouse[]>(
    () => (Array.isArray(data) ? data : []).map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault })),
    [data]
  )
  return { warehouses, isLoading, error, mutate }
}

export function useProductCategories(companyId: string | null) {
  const key = companyKey(companyId, "/api/company/definitions", "&type=PRODUCT_CATEGORY")
  const { data, error, isLoading, mutate } = useSWR<any[]>(key, jsonFetcher)
  const categories = useMemo<string[]>(
    () => (Array.isArray(data) ? data : []).map((d) => String(d.label)).filter(Boolean),
    [data]
  )
  return { categories, isLoading, error, mutate }
}

export function useWarehouseStocks(companyId: string | null) {
  const key = companyKey(companyId, "/api/depolar/stok")
  const { data, error, isLoading, mutate } = useSWR<any>(key, jsonFetcher)
  const stocks = useMemo<RefWarehouseStock[]>(
    () =>
      (Array.isArray(data?.stocks) ? data.stocks : []).map((s: any) => ({
        warehouseId: s.warehouseId,
        productId: s.productId,
        quantity: Number(s.quantity) || 0,
      })),
    [data]
  )
  return { stocks, isLoading, error, mutate }
}

export type RefRecipe = RecipeRecord & { id: string; note: string | null }

/**
 * Firmanın reçeteleri (Restoran & Kafe modülü). Satış ekranı bunları yetersiz
 * stok uyarısı için, reçete ekranı maliyet önizlemesi için kullanır.
 *
 * `recipeMap` sunucunun stok düşümünde kullandığı haritanın birebir aynısıdır
 * (buildRecipeMap → yalnız aktif reçeteler), böylece ekrandaki uyarı ile fiilen
 * düşen miktarlar çelişemez.
 */
export function useRecipes(companyId: string | null) {
  const key = companyKey(companyId, "/api/restoran/recipes")
  const { data, error, isLoading, mutate } = useSWR<any[]>(key, jsonFetcher)
  const recipes = useMemo<RefRecipe[]>(
    () =>
      (Array.isArray(data) ? data : []).map((r) => ({
        id: r.id,
        productId: r.productId,
        yieldQuantity: Number(r.yieldQuantity) || 1,
        isActive: Boolean(r.isActive),
        note: r.note ?? null,
        items: (Array.isArray(r.items) ? r.items : []).map((i: any) => ({
          componentProductId: i.componentProductId,
          quantity: Number(i.quantity) || 0,
          unit: i.unit,
          wastageRate: i.wastageRate != null ? Number(i.wastageRate) : null,
        })),
      })),
    [data]
  )
  const recipeMap = useMemo(() => buildRecipeMap(recipes), [recipes])
  return { recipes, recipeMap, isLoading, error, mutate }
}

/**
 * Fiş tasarım şablonu (Ayarlar > Fiş Tasarımı). Hızlı satış/alış fişi basmadan önce
 * buna ihtiyaç duyar. Şablon yüklenmemişse/çekilemezse varsayılan döner — fiş
 * yazdırma şablon yüzünden asla kırılmamalı.
 */
export function useReceiptTemplate(companyId: string | null) {
  const key = companyKey(companyId, "/api/fis-tasarim")
  const { data, error, isLoading, mutate } = useSWR<any>(key, jsonFetcher)
  const template = useMemo<ReceiptTemplate>(
    () => (data?.template ? normalizeReceiptTemplate(data.template) : DEFAULT_RECEIPT_TEMPLATE),
    [data]
  )
  // Fişe basılacak firma künyesi (adres/telefon/vergi) — şablonla aynı istekte gelir.
  const company = useMemo<ReceiptCompanyInfo>(
    () => ({
      address: data?.company?.address ?? null,
      phone: data?.company?.phone ?? null,
      taxOffice: data?.company?.taxOffice ?? null,
      taxNumber: data?.company?.taxNumber ?? null,
    }),
    [data]
  )
  return { template, company, isLoading, error, mutate }
}
