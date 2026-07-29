"use client"

// Restoran Aşama 2 (masa/adisyon) için SWR hook'ları.
//
// Referans verilerden (use-company-data.ts) ayrı bir dosyada duruyorlar çünkü
// bunlar referans DEĞİL, canlı operasyon verisi: masa doluluğu saniyeler içinde
// değişir ve salon planı açık dururken kendini tazelemek zorundadır.

import useSWR from "swr"
import { jsonFetcher } from "./fetcher"

export type PlanTable = {
  id: string
  name: string
  areaId: string | null
  areaName: string | null
  capacity: number | null
  shape: string
  x: number
  y: number
  width: number
  height: number
  isActive: boolean
  openTicketCount: number
  openTicket: {
    id: string
    code: string
    openedAt: string
    guestCount: number | null
    itemCount: number
    total: number
  } | null
}

export type TicketItem = {
  id: string
  productId: string | null
  description: string
  unit: string
  quantity: number
  unitPrice: number
  vatRate: number
  note: string | null
  order: number
  createdAt: string
}

export type Ticket = {
  id: string
  code: string
  status: string
  tableId: string | null
  tableName: string | null
  areaId: string | null
  customerId: string | null
  customerName: string | null
  guestCount: number | null
  note: string | null
  openedAt: string
  closedAt: string | null
  invoiceId: string | null
  invoiceNo: string | null
  items: TicketItem[]
  totals: { net: number; vat: number; total: number }
}

export type Area = { id: string; name: string; order: number; isActive: boolean }

/** Dükkan krokisi öğesi (duvar, bar, kapı…). Masa değildir; adisyon akışına girmez. */
export type PlanItem = {
  id: string
  areaId: string | null
  kind: string
  label: string | null
  x: number
  y: number
  width: number
  height: number
}

const key = (companyId: string | null, path: string) =>
  companyId ? `${path}${path.includes("?") ? "&" : "?"}companyId=${companyId}` : null

export function useAreas(companyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Area[]>(
    key(companyId, "/api/restoran/bolgeler"),
    jsonFetcher,
  )
  return { areas: Array.isArray(data) ? data : [], error, isLoading, mutate }
}

/**
 * Salon planı. `refreshInterval`: masa doluluğu başka bir garson/kasiyer
 * tarafından değiştirilebildiği için plan kendini periyodik tazeler — aksi halde
 * iki kişi aynı masaya adisyon açmaya çalışır (sunucu 409'la engelliyor ama
 * kullanıcı sebebini ekranda görmeli).
 */
export function useTables(companyId: string | null, opts?: { refreshInterval?: number }) {
  const { data, error, isLoading, mutate } = useSWR<PlanTable[]>(
    key(companyId, "/api/restoran/masalar"),
    jsonFetcher,
    { refreshInterval: opts?.refreshInterval ?? 20000, revalidateOnFocus: true },
  )
  return { tables: Array.isArray(data) ? data : [], error, isLoading, mutate }
}

/**
 * Kroki öğeleri. Masalardan AYRI çekilir ve tazelenmez: duvar saniyede bir
 * değişmez, salon planının 20 saniyelik tazelemesine yük olmasın.
 */
export function usePlanItems(companyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<PlanItem[]>(
    key(companyId, "/api/restoran/plan"),
    jsonFetcher,
    { revalidateOnFocus: false },
  )
  return { planItems: Array.isArray(data) ? data : [], error, isLoading, mutate }
}

export function useTicket(companyId: string | null, ticketId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Ticket>(
    companyId && ticketId ? `/api/restoran/adisyonlar/${ticketId}?companyId=${companyId}` : null,
    jsonFetcher,
  )
  return { ticket: data ?? null, error, isLoading, mutate }
}
