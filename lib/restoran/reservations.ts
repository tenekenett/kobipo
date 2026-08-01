// Rezervasyon — masanın GELECEKTEKİ dolusu (sunucu tarafı).
//
// Adisyondan ayrı yaşar: adisyon "şu an oturan"ı anlatır ve ciroya girer,
// rezervasyon henüz gerçekleşmemiştir. Aynı kayıtta yaşasalardı her ciro
// sorgusu "olacak" hesapları elemek zorunda kalırdı.
//
// Durum akışı: PENDING → SEATED (misafir oturdu, adisyon açıldı)
//                      → NOSHOW (gelmedi) → CANCELLED (iptal)
// SEATED'e YALNIZ adisyon açılışıyla geçilir (POST /api/restoran/adisyonlar);
// el ile işaretlenebilseydi hiçbir adisyona bağlı olmayan "oturdu" kayıtları
// birikir, rezervasyon–ciro bağı anlamını yitirirdi.
//
// Ekranın da kullandığı sabitler `reservation-constants.ts`te — bu dosya Prisma
// çekiyor, tarayıcı paketine girmemeli.

import { Prisma } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"
import type { ReservationStatus } from "./reservation-constants"

export {
  RESERVATION_STATUSES,
  RESERVATION_STATUS_LABEL,
  DEFAULT_DURATION_MIN,
  clampDuration,
  reservationDayRange,
  type ReservationStatus,
} from "./reservation-constants"

export const reservationInclude = Prisma.validator<Prisma.RestaurantReservationInclude>()({
  table: { select: { id: true, name: true } },
})

type ReservationWithRelations = Prisma.RestaurantReservationGetPayload<{
  include: typeof reservationInclude
}>

export function serializeReservation(r: ReservationWithRelations) {
  return {
    id: r.id,
    tableId: r.tableId,
    tableName: r.table?.name ?? null,
    guestName: r.guestName,
    phone: r.phone,
    guestCount: r.guestCount,
    reservedAt: r.reservedAt,
    durationMin: r.durationMin,
    note: r.note,
    status: r.status as ReservationStatus,
    ticketId: r.ticketId,
  }
}

/**
 * Aynı masada zaman aralığı ÇAKIŞAN bekleyen rezervasyon var mı; varsa
 * "20:00 Ahmet Bey" gibi okunur bir etiket döner.
 *
 * Çakışma tek SQL sorgusuyla sorulamıyor: bitiş saati saklanmıyor, süreden
 * türetiliyor (iki alan tutmak ayrışma demekti). Geniş bir pencere çekilip
 * bellekte karşılaştırılıyor — masa başına günde birkaç kayıt olduğu için
 * maliyeti yok.
 */
export async function findReservationClash(
  prisma: PrismaClient,
  params: {
    companyId: string
    tableId: string
    reservedAt: Date
    durationMin: number
    excludeId?: string | null
  },
): Promise<string | null> {
  const { companyId, tableId, reservedAt, durationMin, excludeId } = params
  const windowStart = new Date(reservedAt.getTime() - 8 * 60 * 60000)
  const windowEnd = new Date(reservedAt.getTime() + 8 * 60 * 60000)

  const near = await prisma.restaurantReservation.findMany({
    where: {
      companyId,
      tableId,
      status: "PENDING",
      reservedAt: { gte: windowStart, lte: windowEnd },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { guestName: true, reservedAt: true, durationMin: true },
  })

  const start = reservedAt.getTime()
  const end = start + durationMin * 60000
  for (const r of near) {
    const rStart = r.reservedAt.getTime()
    const rEnd = rStart + r.durationMin * 60000
    if (start < rEnd && rStart < end) {
      const hhmm = r.reservedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
      return `${hhmm} ${r.guestName}`
    }
  }
  return null
}
