"use client"

// Firma kapsamlı referans veriler için SWR hook'ları.
// Amaç: aynı veriyi (ürün, cari, hesap, depo, kategori) her ekranda/mount'ta
// yeniden çekmek yerine URL anahtarıyla önbelleklemek ve dedupe etmek.
// companyId null iken anahtar null olur → SWR fetch atmaz (firma seçilene kadar bekler).

import { useMemo } from "react"
import useSWR from "swr"
import { jsonFetcher } from "./fetcher"

export type RefProduct = {
  id: string
  name: string
  code?: string | null
  salePrice: number | null
  purchasePrice: number | null
  vatRate: number
  unit?: string | null
  category?: string | null
}
export type RefCounterparty = { id: string; name: string; taxNumber?: string | null }
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
        salePrice: p.salePrice != null ? Number(p.salePrice) : null,
        purchasePrice: p.purchasePrice != null ? Number(p.purchasePrice) : null,
        vatRate: Number(p.vatRate) || 20,
        unit: p.unit ?? null,
        category: p.category ?? null,
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
    return items.map((c: any) => ({ id: c.id, name: c.name, taxNumber: c.taxNumber ?? null }))
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
