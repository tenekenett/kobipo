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
import type { ChecklistDay } from "@/lib/restoran/checklist"

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
  /** Doluysa adisyon iptal DEĞİL, başka adisyona birleştirildi — cirosu orada. */
  mergedIntoId: string | null
  cancelReasonCode: string | null
  cancelReason: string | null
  cancelReasonLabel: string | null
  discountType: "PERCENT" | "AMOUNT" | null
  discountValue: number | null
  /** Sabit sebep kodu (rapor bunu gruplar) — serbest metin `discountReason` yanında durur. */
  discountReasonCode: string | null
  discountReason: string | null
  discountReasonLabel: string | null
  /** İskontoyu UYGULAYAN personel (İK kartı) — oturumu açan kullanıcı değil. */
  discountEmployeeId: string | null
  discountEmployeeName: string | null
  discountAt: string | null
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

/** Bölge = bir KROKİ. `gridSize` tuvalin SÜTUN sayısıdır (hücre); satır sayısı
 *  saklanmaz, orandan ve içerikten türer (bkz. lib/restoran/floor-plan). */
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
 * Bir GÜNÜN adisyonları — açık, kapanan ve iptal edilenler birlikte.
 *
 * `useOpenTickets`ten ayrı duruyor çünkü ikisi farklı soruya bakıyor: açık liste
 * "şu an hangi hesap duruyor" (gün fark etmez, dünden sarkan masa da orada),
 * bu ise "seçilen gün ne kesildi". Adisyon ekranı ikisini birleştirip gösteriyor.
 *
 * Tazeleme yok: geçmiş bir gün seçiliyken periyodik istek boşa gider; bugünün
 * canlı tarafını zaten `useOpenTickets` tazeliyor.
 */
export function useDayTickets(companyId: string | null, day: string | null) {
  const range = day ? dayRange(day) : null
  const { data, error, isLoading, mutate } = useSWR<Ticket[]>(
    range
      ? key(
          companyId,
          `/api/restoran/adisyonlar?status=ALL&limit=200&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        )
      : null,
    jsonFetcher,
    { revalidateOnFocus: true },
  )
  return { tickets: Array.isArray(data) ? data : [], error, isLoading, mutate }
}

/** `YYYY-MM-DD` → günün YEREL sınırları. Sunucuya UTC gider ama gün, kullanıcının
 *  saatiyle başlayıp biter: 00:30'da kesilen adisyon dünün listesine düşmesin. */
function dayRange(day: string): { from: string; to: string } {
  const [y, m, d] = day.split("-").map(Number)
  return {
    from: new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString(),
    to: new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).toISOString(),
  }
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

/** Kim yaptı — adisyon detayındaki personel izi. */
export type StaffRef = { id: string; name: string } | null

/**
 * Kapanmış adisyonun DENETİM görünümü: `Ticket` + "bu hesapta ne oldu" alanları.
 * Kararlar: docs/restoran/ADISYON-DETAY.md K2
 *
 * Tip ELLE yazılıyor, sunucudaki `TicketDetailExtras`tan türetilmiyor: o dosya
 * (`lib/restoran/ticket-detail.ts`) prisma import ediyor ve istemci paketine
 * girmemeli. `Ticket` tipi de aynı sebeple burada elle duruyor.
 */
export type TicketDetail = Ticket & {
  /** Oturma süresi (dk). Adisyon açıkken null. */
  durationMin: number | null
  staff: {
    openedBy: StaffRef
    closedBy: StaffRef
    billRequestedBy: StaffRef
    discountBy: StaffRef
  }
  /** Kalem id → ekleyen kullanıcının adı. */
  itemCreators: Record<string, string>
  /** Kalem id → ikramı veren personelin adı (yalnız ikram kalemlerinde). */
  itemCompEmployees: Record<string, string>
  invoice: {
    id: string
    slug: string
    invoiceNo: string
    status: string
    netAmount: number
    vatAmount: number
    totalAmount: number
    globalDiscountAmount: number
    paidTotal: number
    /** Tahsil edilmemiş kalan — kapanışta parça yazılamamışsa burada görünür. */
    remaining: number
    paymentStatus: "PAID" | "PARTIAL" | "OPEN"
    payments: Array<{
      id: string
      amount: number
      method: string
      methodLabel: string
      paymentDate: string
      accountName: string | null
      notes: string | null
    }>
  } | null
  merge: {
    into: { id: string; code: string } | null
    from: Array<{ id: string; code: string; total: number }>
  }
  reservation: { id: string; guestName: string; reservedAt: string } | null
}

/**
 * Adisyon + denetim alanları. `useTicket`ten AYRI bir SWR anahtarı kullanır
 * (`&detail=1`): canlı satış ekranı sade uçtan beslenmeye devam etsin, personel
 * ve ödeme sorguları her kalem eklemede tekrarlanmasın.
 */
export function useTicketDetail(companyId: string | null, ticketId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<TicketDetail>(
    companyId && ticketId
      ? `/api/restoran/adisyonlar/${ticketId}?companyId=${companyId}&detail=1`
      : null,
    jsonFetcher,
  )
  return { ticket: data ?? null, error, isLoading, mutate }
}

/**
 * Bir günün açılış/kapanış listesi durumu (maddeler + o günün onayları +
 * personel seçenekleri, tek istekte).
 *
 * `revalidateOnFocus`: uyarı şeridi satış ekranının tepesinde saatlerce açık
 * durur; listeyi başka bir cihazdan (mutfak tableti) tamamlayan personelin
 * ardından şerit kendiliğinden kaybolmalı. Periyodik tazeleme YOK — liste günde
 * bir kez doldurulur, 20 saniyelik yoklama boşa giderdi.
 */
export function useChecklistDay(
  companyId: string | null,
  type: "OPENING" | "CLOSING",
  date: string | null,
) {
  const { data, error, isLoading, mutate } = useSWR<ChecklistDay>(
    companyId && date
      ? `/api/restoran/kontrol-listesi/gun?companyId=${companyId}&type=${type}&date=${date}`
      : null,
    jsonFetcher,
    { revalidateOnFocus: true },
  )
  return { day: data ?? null, error, isLoading, mutate }
}

/** Maddelerin kendisi — patronun düzenleme ekranı için (`all=1` pasifleri de getirir). */
export function useChecklistItems(companyId: string | null, opts?: { all?: boolean }) {
  const suffix = opts?.all ? "&all=1" : ""
  const { data, error, isLoading, mutate } = useSWR<ChecklistItemRow[]>(
    companyId ? `/api/restoran/kontrol-listesi?companyId=${companyId}${suffix}` : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  )
  return { items: Array.isArray(data) ? data : [], error, isLoading, mutate }
}

export type ChecklistItemRow = {
  id: string
  type: "OPENING" | "CLOSING"
  title: string
  sortOrder: number
  isActive: boolean
}
