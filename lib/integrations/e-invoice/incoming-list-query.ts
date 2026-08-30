import { Prisma } from "@prisma/client"
import { parseTrNumber } from "@/lib/format"

/**
 * GELEN E-FATURA LİSTESİNİN SORGUSU — tek kaynak.
 *
 * Hem ekranın listesi (`/api/e-donusum/inbox`) hem de dışa aktarma
 * (`lib/export/datasets/gelen-e-faturalar.ts`) bu modülü çağırır. Dışa aktarma kendi
 * sorgusunu YAZMAZ: iki yerde iki filtre mantığı, "ekranda 36 satır görüyorum ama
 * Excel'de 41 satır var" demektir ve fark aylarca fark edilmez.
 *
 * Tarih ekseni seçilebilir: belge tarihi (`docDate`) ya da zarfın GİB'e düştüğü an
 * (`sentDate`). İkisi günlerce ayrışıyor — geçen ay düzenlenip bu hafta gönderilen
 * fatura yalnız ikinci eksende bu haftaya düşer.
 */

export type IncomingDateField = "docDate" | "sentDate"

export type IncomingListFilters = {
  dateField: IncomingDateField
  startDate: Date
  endDate: Date
  /** "" | "KABUL" | "RED" | "BEKLEMEDE" | Mysoft'un başka bir durum metni */
  status: string
  profile: string
  linked: "" | "linked" | "unlinked"
  /** Genel arama: fatura no / gönderici ünvanı / VKN / ETTN */
  q: string
  sender: string
  taxNumber: string
  minAmount: number | null
  maxAmount: number | null
}

export type IncomingListPaging = { page: number; pageSize: number }

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 500

/** Liste satırının ihtiyaç duyduğu alanlar. `raw` KASTEN yok — fatura başına tam
 *  Mysoft JSON'u, 500 satırlık sayfada boşuna megabaytlar demek. */
export const INCOMING_LIST_SELECT = {
  id: true,
  uuid: true,
  invoiceNo: true,
  docDate: true,
  sentDate: true,
  senderName: true,
  senderTaxNumber: true,
  profile: true,
  invoiceType: true,
  currencyCode: true,
  currencyRate: true,
  taxExclusiveAmount: true,
  vatAmount: true,
  payableAmount: true,
  status: true,
  envelopeStatusCode: true,
  envelopeStatusDesc: true,
  isArchived: true,
  isLinkedToPurchase: true,
  linkedInvoiceId: true,
  syncedAt: true,
} as const

/**
 * `days` / `startDate` / `endDate` paramlarından aralığı çözer.
 * Canlı (Mysoft) mod da aynı aralığı kullandığı için ayrı fonksiyon.
 */
export function resolveIncomingDateRange(
  params: URLSearchParams,
): { ok: true; start: Date; end: Date } | { ok: false; error: string } {
  const days = Number(params.get("days") || "30")
  const endParam = params.get("endDate")
  const startParam = params.get("startDate")
  const end = endParam ? new Date(endParam) : new Date()
  const start = startParam
    ? new Date(startParam)
    : new Date(end.getTime() - Math.max(1, days) * DAY_MS)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: "Tarih aralığı geçersiz." }
  }
  if (start > end) {
    return { ok: false, error: "Başlangıç tarihi bitiş tarihinden sonra olamaz." }
  }
  return { ok: true, start, end }
}

/**
 * Filtreleri paramlardan okur. Sayıya çevrilemeyen tutar SESSİZCE YUTULMAZ — hata
 * döner. (Önceden `Number.isFinite` tutmayan değer atlanıyordu: ekran "3 filtre
 * uygulandı" derken sunucu ikisini görmezden geliyordu.)
 */
export function parseIncomingListFilters(
  params: URLSearchParams,
  range: { start: Date; end: Date },
): { ok: true; filters: IncomingListFilters } | { ok: false; error: string } {
  const trimmed = (key: string) => (params.get(key) || "").trim()

  const minAmountRaw = trimmed("minAmount")
  const maxAmountRaw = trimmed("maxAmount")
  const minAmount = minAmountRaw ? parseTrNumber(minAmountRaw) : null
  const maxAmount = maxAmountRaw ? parseTrNumber(maxAmountRaw) : null
  if (minAmountRaw && minAmount === null) return { ok: false, error: "Tutar (min) sayı olmalı." }
  if (maxAmountRaw && maxAmount === null) return { ok: false, error: "Tutar (max) sayı olmalı." }

  const linkedRaw = trimmed("linked")

  return {
    ok: true,
    filters: {
      dateField: params.get("dateField") === "sentDate" ? "sentDate" : "docDate",
      startDate: range.start,
      endDate: range.end,
      status: trimmed("status").toUpperCase(),
      profile: trimmed("profile"),
      linked: linkedRaw === "linked" || linkedRaw === "unlinked" ? linkedRaw : "",
      q: trimmed("q"),
      sender: trimmed("sender"),
      taxNumber: trimmed("taxNumber"),
      minAmount,
      maxAmount,
    },
  }
}

export function parseIncomingListPaging(params: URLSearchParams): IncomingListPaging {
  const page = Math.max(1, Number(params.get("page") || "1") || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(params.get("pageSize") || String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE),
  )
  return { page, pageSize }
}

/**
 * Tarih DIŞINDAKİ koşullar. Ayrı duruyor çünkü iki yerde tarihsiz hâline ihtiyaç var:
 * "gönderilme tarihi olmayan kaç kayıt var" sayımı ve liste boşken "aralığın dışında
 * kayıt var mı" ipucu.
 */
export function buildIncomingFilterConditions(
  filters: IncomingListFilters,
): Prisma.IncomingInvoiceWhereInput[] {
  const and: Prisma.IncomingInvoiceWhereInput[] = []

  // Durum: KABUL/RED terminaldir, "BEKLEMEDE" = terminal OLMAYAN her şey. Mysoft
  // bekleyen için "YANIT_BEKLENIYOR" / "KABUL_KUYRUGUNDA" gibi metinler döndürüyor;
  // düz eşitlik yazsaydık bekleyenlerin TAMAMI listeden düşerdi (ölçüldü: 36 → 0).
  const notStatus = (value: string): Prisma.IncomingInvoiceWhereInput => ({
    NOT: { status: { equals: value, mode: "insensitive" } },
  })
  if (filters.status === "BEKLEMEDE") {
    and.push({ OR: [{ status: null }, { AND: [notStatus("KABUL"), notStatus("RED")] }] })
  } else if (filters.status) {
    and.push({ status: { equals: filters.status, mode: "insensitive" } })
  }

  if (filters.profile) and.push({ profile: filters.profile })
  if (filters.linked === "linked") and.push({ isLinkedToPurchase: true })
  if (filters.linked === "unlinked") and.push({ isLinkedToPurchase: false })
  if (filters.sender) and.push({ senderName: { contains: filters.sender, mode: "insensitive" } })
  if (filters.taxNumber) and.push({ senderTaxNumber: { contains: filters.taxNumber } })
  if (filters.minAmount !== null) {
    and.push({ payableAmount: { gte: new Prisma.Decimal(filters.minAmount) } })
  }
  if (filters.maxAmount !== null) {
    and.push({ payableAmount: { lte: new Prisma.Decimal(filters.maxAmount) } })
  }
  // "q" kendi OR'unu taşıdığı için AND dizisine giriyor: düz nesne yayılımıyla
  // birleştirmek ikinci bir OR anahtarı yaratıp öncekini sessizce ezerdi.
  if (filters.q) {
    and.push({
      OR: [
        { invoiceNo: { contains: filters.q, mode: "insensitive" } },
        { senderName: { contains: filters.q, mode: "insensitive" } },
        { senderTaxNumber: { contains: filters.q } },
        { uuid: { contains: filters.q, mode: "insensitive" } },
      ],
    })
  }

  return and
}

/** Tarih koşulu dahil, listenin tam `where`i. */
export function buildIncomingWhere(
  companyId: string,
  filters: IncomingListFilters,
): Prisma.IncomingInvoiceWhereInput {
  const and = buildIncomingFilterConditions(filters)
  const dateFilter = { gte: filters.startDate, lte: filters.endDate }
  return {
    companyId,
    ...(filters.dateField === "sentDate" ? { sentDate: dateFilter } : { docDate: dateFilter }),
    ...(and.length ? { AND: and } : {}),
  }
}

/** Tarih koşulu OLMADAN aynı filtreler. */
export function buildIncomingWhereWithoutDate(
  companyId: string,
  filters: IncomingListFilters,
): Prisma.IncomingInvoiceWhereInput {
  const and = buildIncomingFilterConditions(filters)
  return { companyId, ...(and.length ? { AND: and } : {}) }
}

export function incomingOrderBy(
  dateField: IncomingDateField,
): Prisma.IncomingInvoiceOrderByWithRelationInput[] {
  return dateField === "sentDate"
    ? [{ sentDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
    : [{ docDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
}

const STATUS_LABELS: Record<string, string> = {
  KABUL: "Kabul edilenler",
  RED: "Reddedilenler",
  BEKLEMEDE: "Yanıt bekleyenler",
}
const PROFILE_LABELS: Record<string, string> = {
  TICARIFATURA: "Ticari Fatura",
  TEMELFATURA: "Temel Fatura",
  EARSIVFATURA: "E-Arşiv",
  EFATURA: "E-Fatura",
}

const trDate = (d: Date) => d.toLocaleDateString("tr-TR")
const trMoney = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

/**
 * Uygulanan filtrelerin okunur özeti — dışa aktarılan belgenin başlığına yazılır.
 * Kullanıcı indirdiği dosyanın hangi filtreyle üretildiğini altı ay sonra da görmeli.
 */
export function describeIncomingFilters(filters: IncomingListFilters): string[] {
  const out: string[] = [
    `${filters.dateField === "sentDate" ? "Gönderilme" : "Fatura"} tarihi: ${trDate(
      filters.startDate,
    )} – ${trDate(filters.endDate)}`,
  ]
  if (filters.status) out.push(`Durum: ${STATUS_LABELS[filters.status] ?? filters.status}`)
  if (filters.profile) out.push(`Profil: ${PROFILE_LABELS[filters.profile] ?? filters.profile}`)
  if (filters.linked === "linked") out.push("Yalnız alış faturasına dönüştürülenler")
  if (filters.linked === "unlinked") out.push("Yalnız dönüştürülmeyenler")
  if (filters.sender) out.push(`Gönderici: ${filters.sender}`)
  if (filters.taxNumber) out.push(`VKN/TCKN: ${filters.taxNumber}`)
  if (filters.q) out.push(`Arama: ${filters.q}`)
  if (filters.minAmount !== null) out.push(`Tutar ≥ ${trMoney(filters.minAmount)}`)
  if (filters.maxAmount !== null) out.push(`Tutar ≤ ${trMoney(filters.maxAmount)}`)
  return out
}
