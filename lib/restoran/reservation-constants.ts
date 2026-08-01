// Rezervasyon sabitleri — Prisma'ya DOKUNMAZ.
//
// `reservations.ts`ten ayrı durmasının sebebi `ticket-constants.ts` ile aynı:
// bu değerleri ekran da kullanıyor, oradan import etmek Prisma istemcisini
// tarayıcı paketine sokardı.

export const RESERVATION_STATUSES = ["PENDING", "SEATED", "NOSHOW", "CANCELLED"] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDING: "Bekliyor",
  SEATED: "Oturdu",
  NOSHOW: "Gelmedi",
  CANCELLED: "İptal",
}

/** Varsayılan oturma süresi (dk) — masanın ne kadar tutulacağı. */
export const DEFAULT_DURATION_MIN = 90

/** 15 dk – 8 saat. Sınırsız süre masayı bütün gün rezerve gösterirdi. */
export function clampDuration(value: unknown): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MIN
  return Math.min(480, Math.max(15, n))
}

/** Filtresiz istek BUGÜNÜ döndürür — liste geçmişe doğru sınırsız büyümesin. */
export function reservationDayRange(from: string | null, to: string | null) {
  if (from || to) {
    return {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { gte: start, lt: end }
}
