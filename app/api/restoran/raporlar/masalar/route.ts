// Masa & adisyon raporu — Aşama 2 Faz D (docs/restoran/ASAMA2.md).
//
// Diğer dört rapor "ne satıldı, ne kazanıldı" sorusuna bakar; bu rapor MASAYA
// bakar: hesap ne kadar sürdü, masa günde kaç kez döndü, hangi masa/bölge ne
// kadar getirdi, salon hangi saatte doluyor.
//
// TARİH EKSENİ = KAPANIŞ (`closedAt`). Diğer raporlar belge tarihini kullanıyor;
// burada bilinçli olarak kapanış anı esas alınıyor çünkü ölçülen şey masanın
// boşaldığı andır. Pratikte ikisi aynı: fiş adisyon kapanırken kesiliyor.
//
// CİRO FATURADAN gelir, adisyon kalemlerinden değil. Adisyon toplamı gösterim
// içindir; kesin tutarı (iskonto, yuvarlama dahil) fatura ucu hesaplar. İptal
// edilen fişler dışarıda — `reportScope` ile aynı durum dışlaması.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { Prisma } from "@prisma/client"
import { localDay, localHour, num, parseRange } from "@/lib/restoran/reports"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Bir boşluğun "devir arası bekleme" sayılması için üst sınır (dakika).
 *
 * Boş bekleme, aynı masada ARDIŞIK iki adisyonun arasındaki süredir. Sınır
 * olmasaydı öğle servisi 14:00'te biten bir masanın akşam 19:00'da açılması
 * "5 saat boş bekledi" diye ortalamaya girer ve rakamı anlamsız kılardı —
 * oysa orada masa beklemiyor, servis yok. Gün değişimi de zaten dışarıda:
 * boşluk yalnız aynı YEREL GÜN içinde ölçülüyor.
 */
const IDLE_MAX_MINUTES = 120

type TicketRow = {
  id: string
  table_id: string | null
  table_name: string | null
  area_id: string | null
  area_name: string | null
  guest_count: number | null
  minutes: unknown
  /** Aynı masada bir önceki adisyonun kapanışından bu adisyonun açılışına
   *  geçen süre. Günün ilk adisyonunda ve masasız adisyonlarda NULL. */
  idle_minutes: unknown
  open_hour: number
  net: unknown
  gross: unknown
}

/** Masasız (paket/gel-al) adisyonlar tek satırda toplanır. */
const TAKEAWAY_KEY = "__takeaway__"

type Bucket = {
  key: string
  name: string
  areaName: string | null
  tickets: number
  revenue: number
  minutesTotal: number
  /** Süresi ölçülebilen adisyon sayısı — ortalamanın paydası. */
  minutesCount: number
  idleTotal: number
  /** Ölçülebilen boşluk sayısı; ortalamanın paydası adisyon sayısı DEĞİL
   *  (günün ilk adisyonundan önce boşluk yoktur). */
  idleCount: number
  guests: number
}

const emptyBucket = (key: string, name: string, areaName: string | null): Bucket => ({
  key,
  name,
  areaName,
  tickets: 0,
  revenue: 0,
  minutesTotal: 0,
  minutesCount: 0,
  idleTotal: 0,
  idleCount: 0,
  guests: 0,
})

const finishBucket = (b: Bucket) => ({
  key: b.key,
  name: b.name,
  areaName: b.areaName,
  tickets: b.tickets,
  revenue: b.revenue,
  avgTicket: b.tickets > 0 ? b.revenue / b.tickets : 0,
  avgMinutes: b.minutesCount > 0 ? b.minutesTotal / b.minutesCount : null,
  avgIdleMinutes: b.idleCount > 0 ? b.idleTotal / b.idleCount : null,
  idleMinutes: b.idleTotal,
  idleGaps: b.idleCount,
  guests: b.guests,
})

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    // Aşama 2 uçları baştan kapıdan geçer. v1'in dört rapor ucu hâlâ korumasız —
    // ayrı iş (bkz. SADELESTIRME.md "Sırada ne var"); yenisini açık bırakmıyoruz.
    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const { start, end } = parseRange(searchParams)

    const [rows, activeTables] = await Promise.all([
      prisma.$queryRaw<TicketRow[]>`
        SELECT t.id,
               t."tableId"                                                   AS table_id,
               tb.name                                                       AS table_name,
               tb."areaId"                                                   AS area_id,
               ar.name                                                       AS area_name,
               t."guestCount"                                                AS guest_count,
               EXTRACT(EPOCH FROM (t."closedAt" - t."openedAt")) / 60        AS minutes,
               -- Boş bekleme: aynı masada bir önceki adisyonun kapanışıyla bu
               -- adisyonun açılışı arasındaki süre. Bölümleme masa + YEREL GÜN:
               -- gün değişimini boşluk saymak her masaya her gece "12 saat boş
               -- bekledi" yazardı. Günün ilk adisyonunda LAG null döner.
               EXTRACT(EPOCH FROM (
                 t."openedAt" - LAG(t."closedAt") OVER (
                   PARTITION BY t."tableId", ${localDay(Prisma.sql`t."openedAt"`)}
                   ORDER BY t."openedAt"
                 )
               )) / 60                                                       AS idle_minutes,
               ${localHour(Prisma.sql`t."openedAt"`)}                        AS open_hour,
               i."netAmount"                                                 AS net,
               i."totalAmount"                                               AS gross
        FROM restaurant_tickets t
        JOIN invoices i ON i.id = t."invoiceId"
        LEFT JOIN restaurant_tables tb ON tb.id = t."tableId"
        LEFT JOIN restaurant_areas ar ON ar.id = tb."areaId"
        WHERE t."companyId" = ${companyId}
          AND t.status = 'CLOSED'
          AND t."closedAt" >= ${start}
          AND t."closedAt" <= ${end}
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        ORDER BY t."closedAt"
      `,
      // Devir hızının paydası: salonda KAÇ masa var. Pasif masalar sayılmaz —
      // kaldırılmış bir masa bugünkü devir hızını düşürmemeli.
      prisma.restaurantTable.count({ where: { companyId, isActive: true } }),
    ])

    const byTable = new Map<string, Bucket>()
    const byArea = new Map<string, Bucket>()
    const byHour = new Map<number, { tickets: number; revenue: number }>()

    let revenue = 0
    let revenueNet = 0
    let minutesTotal = 0
    let minutesCount = 0
    let idleTotal = 0
    let idleCount = 0
    let idleSkipped = 0
    let guests = 0
    let guestTickets = 0

    for (const r of rows) {
      const gross = num(r.gross)
      const net = num(r.net)
      revenue += gross
      revenueNet += net

      // Süre negatifse (saat düzeltmesi, elle müdahale) ortalamayı bozmasın diye
      // atılır — 0 saymak ortalamayı sessizce aşağı çekerdi.
      const rawMinutes = Number(r.minutes)
      const hasMinutes = Number.isFinite(rawMinutes) && rawMinutes >= 0
      if (hasMinutes) {
        minutesTotal += rawMinutes
        minutesCount += 1
      }

      // Boş bekleme yalnız GERÇEK masalarda anlamlı: paket/gel-al adisyonlarının
      // arasındaki boşluk bir masanın beklemesi değildir.
      const rawIdle = r.idle_minutes == null ? null : Number(r.idle_minutes)
      const idleMeasured =
        r.table_id != null && rawIdle != null && Number.isFinite(rawIdle) && rawIdle >= 0
      const hasIdle = idleMeasured && (rawIdle as number) <= IDLE_MAX_MINUTES
      if (idleMeasured && !hasIdle) idleSkipped += 1
      if (hasIdle) {
        idleTotal += rawIdle as number
        idleCount += 1
      }

      if (r.guest_count != null && r.guest_count > 0) {
        guests += r.guest_count
        guestTickets += 1
      }

      const tableKey = r.table_id ?? TAKEAWAY_KEY
      const tableName = r.table_id ? (r.table_name ?? "—") : "Paket / Gel-al"
      let tb = byTable.get(tableKey)
      if (!tb) {
        tb = emptyBucket(tableKey, tableName, r.area_name)
        byTable.set(tableKey, tb)
      }
      tb.tickets += 1
      tb.revenue += gross
      tb.guests += r.guest_count ?? 0
      if (hasMinutes) {
        tb.minutesTotal += rawMinutes
        tb.minutesCount += 1
      }
      if (hasIdle) {
        tb.idleTotal += rawIdle as number
        tb.idleCount += 1
      }

      // Bölgesiz masalar da bir kovaya düşmeli, yoksa bölge toplamları genel
      // toplamı tutmaz ve kullanıcı farkı arar.
      const areaKey = r.table_id ? (r.area_id ?? "__noarea__") : TAKEAWAY_KEY
      const areaName = r.table_id ? (r.area_name ?? "Bölgesiz") : "Paket / Gel-al"
      let ar = byArea.get(areaKey)
      if (!ar) {
        ar = emptyBucket(areaKey, areaName, null)
        byArea.set(areaKey, ar)
      }
      ar.tickets += 1
      ar.revenue += gross
      ar.guests += r.guest_count ?? 0
      if (hasMinutes) {
        ar.minutesTotal += rawMinutes
        ar.minutesCount += 1
      }
      if (hasIdle) {
        ar.idleTotal += rawIdle as number
        ar.idleCount += 1
      }

      const hour = Number.isFinite(r.open_hour) ? r.open_hour : 0
      const h = byHour.get(hour) ?? { tickets: 0, revenue: 0 }
      h.tickets += 1
      h.revenue += gross
      byHour.set(hour, h)
    }

    const tickets = rows.length
    const tablesUsed = [...byTable.keys()].filter((k) => k !== TAKEAWAY_KEY).length

    return NextResponse.json({
      range: { start: start.toISOString(), end: end.toISOString() },
      summary: {
        tickets,
        revenue,
        revenueNet,
        avgTicket: tickets > 0 ? revenue / tickets : 0,
        avgMinutes: minutesCount > 0 ? minutesTotal / minutesCount : null,
        guests,
        // Kişi başı ortalama YALNIZ kişi sayısı girilmiş adisyonlardan hesaplanır;
        // boş bırakılanları 0 saymak rakamı gerçek dışı düşürürdü.
        avgGuests: guestTickets > 0 ? guests / guestTickets : null,
        revenuePerGuest: guests > 0 ? revenue / guests : null,
        guestTickets,
        tablesUsed,
        activeTables,
        // Devir hızı: aralık boyunca masa başına düşen adisyon sayısı.
        turnover: activeTables > 0 ? tickets / activeTables : null,
        // Boş bekleme: masa boşaldıktan sonra bir sonraki müşteriye kadar geçen
        // ölü zaman. Devir hızını artırmanın en ucuz yolu burayı kısaltmaktır —
        // masa eklemek gerekmez.
        avgIdleMinutes: idleCount > 0 ? idleTotal / idleCount : null,
        idleMinutes: idleTotal,
        idleGaps: idleCount,
        /** Servis arası sayıldığı için ortalamaya girmeyen uzun boşluk sayısı. */
        idleSkipped,
        idleMaxMinutes: IDLE_MAX_MINUTES,
      },
      tables: [...byTable.values()].map(finishBucket).sort((a, b) => b.revenue - a.revenue),
      areas: [...byArea.values()].map(finishBucket).sort((a, b) => b.revenue - a.revenue),
      hours: [...byHour.entries()]
        .map(([hour, v]) => ({ hour, tickets: v.tickets, revenue: v.revenue }))
        .sort((a, b) => a.hour - b.hour),
    })
  } catch (error: any) {
    if (String(error?.message).includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("[Restoran] Masa raporu hatası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
