"use client"

// Restoran Aşama 2 (masa/adisyon) için SWR hook'ları.
//
// Referans verilerden (use-company-data.ts) ayrı bir dosyada duruyorlar çünkü
// bunlar referans DEĞİL, canlı operasyon verisi: masa doluluğu saniyeler içinde
// değişir ve salon planı açık dururken kendini tazelemek zorundadır.

import useSWR from "swr"
import { jsonFetcher } from "./fetcher"
import type { OptionGroupView } from "@/lib/restoran/product-options"
import type { TicketItemOption, TicketItemStatus } from "@/lib/restoran/ticket-constants"

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
  /** Hesap kapandı, masa toplanmadı. Masayı kilitlemez; yeni adisyon temizler. */
  cleaningSince: string | null
  openTicketCount: number
  openTicket: {
    id: string
    code: string
    openedAt: string
    guestCount: number | null
    itemCount: number
    total: number
    /** Müşteri hesap istedi — adisyon hâlâ açık, masa planda ayrı renkte. */
    billRequestedAt: string | null
  } | null
  /** Masanın YAKLAŞAN rezervasyonu (yalnız bekleyen ve zaman penceresindeki). */
  reservation: {
    id: string
    guestName: string
    guestCount: number | null
    reservedAt: string
    /** Rezervasyon saatine kalan dakika; geçtiyse negatif. */
    minutesUntil: number
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
  /** NORMAL | COMP (ikram) | WASTE (zayi) | VOID (iptal) — bkz. ticket-constants. */
  status: TicketItemStatus
  reasonCode: string | null
  reason: string | null
  reasonLabel: string | null
  options: TicketItemOption[]
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
  /** Müşteri hesap istedi (adisyon açık kalır). Kapanışta temizlenir. */
  billRequestedAt: string | null
  closedAt: string | null
  invoiceId: string | null
  invoiceNo: string | null
  discountType: "PERCENT" | "AMOUNT" | null
  discountValue: number | null
  discountReason: string | null
  items: TicketItem[]
  totals: {
    net: number
    vat: number
    /** İskonto öncesi, KDV dahil. */
    gross: number
    discount: number
    netDiscount: number
    total: number
  }
}

/** Bölge = bir KROKİ. `gridSize` kare tuvalin kenar uzunluğudur (hücre). */
export type Area = {
  id: string
  name: string
  order: number
  gridSize: number
  isActive: boolean
}

export type Reservation = {
  id: string
  tableId: string | null
  tableName: string | null
  guestName: string
  phone: string | null
  guestCount: number | null
  reservedAt: string
  durationMin: number
  note: string | null
  status: "PENDING" | "SEATED" | "NOSHOW" | "CANCELLED"
  ticketId: string | null
}

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
 * Rezervasyonlar. Varsayılan olarak BUGÜNÜ getirir (`from`/`to` verilmezse) —
 * rezervasyon listesi geçmişe doğru sınırsız büyür, salon ekranının ilgilendiği
 * yalnız bugünkü akıştır.
 */
export function useReservations(
  companyId: string | null,
  opts?: { from?: string; to?: string; refreshInterval?: number },
) {
  const query = new URLSearchParams()
  if (opts?.from) query.set("from", opts.from)
  if (opts?.to) query.set("to", opts.to)
  const suffix = query.toString()
  const { data, error, isLoading, mutate } = useSWR<Reservation[]>(
    key(companyId, `/api/restoran/rezervasyonlar${suffix ? `?${suffix}` : ""}`),
    jsonFetcher,
    { refreshInterval: opts?.refreshInterval ?? 60000 },
  )
  return { reservations: Array.isArray(data) ? data : [], error, isLoading, mutate }
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

/**
 * Açık adisyonlar. Salon planı masaya bakar; bu liste HESABA bakar — masasız
 * (paket/gel-al) adisyonun tek görünür olduğu yer burasıdır.
 */
export function useOpenTickets(companyId: string | null, opts?: { refreshInterval?: number }) {
  const { data, error, isLoading, mutate } = useSWR<Ticket[]>(
    key(companyId, "/api/restoran/adisyonlar"),
    jsonFetcher,
    { refreshInterval: opts?.refreshInterval ?? 20000, revalidateOnFocus: true },
  )
  return { tickets: Array.isArray(data) ? data : [], error, isLoading, mutate }
}

/**
 * Ürün seçenekleri (porsiyon/modifier) — firma başına TEK çağrı.
 *
 * Ürün başına çağırmak, kasiyerin bastığı her üründe ağ turu demekti; seçenek
 * diyaloğunun ANINDA açılması bu ekranın tek performans şartı. Seçenek tanımı
 * nadir değiştiği için tazeleme de kapalı.
 */
export function useProductOptions(companyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<OptionGroupView[]>(
    key(companyId, "/api/restoran/urun-secenekleri"),
    jsonFetcher,
    { revalidateOnFocus: false },
  )
  const groups = Array.isArray(data) ? data : []
  const byProduct = new Map<string, OptionGroupView[]>()
  for (const group of groups) {
    const list = byProduct.get(group.productId) ?? []
    list.push(group)
    byProduct.set(group.productId, list)
  }
  return {
    optionGroups: groups,
    /** Ürünün seçenek grupları; yoksa boş dizi (diyalog hiç açılmaz). */
    groupsOf: (productId: string | null | undefined) =>
      (productId ? byProduct.get(productId) : undefined) ?? [],
    error,
    isLoading,
    mutate,
  }
}

export function useTicket(companyId: string | null, ticketId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Ticket>(
    companyId && ticketId ? `/api/restoran/adisyonlar/${ticketId}?companyId=${companyId}` : null,
    jsonFetcher,
  )
  return { ticket: data ?? null, error, isLoading, mutate }
}
