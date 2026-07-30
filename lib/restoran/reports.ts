// Restoran & Kafe raporlarının ortak sorgu iskeleti.
// Dört rapor da (karlılık, menü performansı, tüketim, gün sonu) AYNI kapsam
// tanımını kullanmak zorunda; aksi halde aynı gün için farklı ciro/maliyet
// gösterirler. Tanım bu yüzden tek dosyada duruyor.
//
// Bkz. docs/restoran/PLAN.md "Adım 6", ILERLEME.md "Adım 8".

import { Prisma } from "@prisma/client"
import { avgCostCte } from "@/lib/stock/cost"
import { isBillableItem, ticketDiscountOf, ticketTotals } from "@/lib/restoran/tickets"
import type { prisma } from "@/lib/db/prisma"

/** Reçeteden türeyen stok hareketlerinin işareti — satış anında yazılır. */
export const RECIPE_MARK = "%Reçete:%"

/**
 * Postgres kolonları `timestamp without time zone` ve UTC saklıyor. Gün kırılımı
 * yerel takvim gününe göre olmalı: TSİ 01:00'daki satış UTC'de bir önceki güne
 * düşer, gün sonu raporunda yanlış güne yazılırdı.
 */
export const localDay = (col: Prisma.Sql) =>
  Prisma.sql`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date`

/**
 * Yerel saat (0–23). Yoğunluk grafiği için: "en yoğun saat 20:00" derken kastedilen
 * TSİ 20:00'dir, UTC 20:00 değil. `localDay` ile aynı dönüşüm.
 */
export const localHour = (col: Prisma.Sql) =>
  Prisma.sql`EXTRACT(HOUR FROM ((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul'))::int`

export type ReportRange = { start: Date; end: Date }

/**
 * `?startDate=&endDate=` okur. İstemci yerel gün sınırlarını ISO'ya çevirip
 * gönderir; sunucu saat dilimi varsaymaz. Verilmezse son 30 gün.
 *
 * `end` DAHİL kabul edilir: yalnız tarih gelirse (2026-07-26) günün sonuna taşınır,
 * aksi halde "bugünü" seçen kullanıcı hiçbir şey göremezdi.
 */
export function parseRange(searchParams: URLSearchParams): ReportRange {
  const rawStart = searchParams.get("startDate")
  const rawEnd = searchParams.get("endDate")

  const end = rawEnd ? new Date(rawEnd) : new Date()
  if (rawEnd && /^\d{4}-\d{2}-\d{2}$/.test(rawEnd)) end.setHours(23, 59, 59, 999)

  const start = rawStart ? new Date(rawStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (rawStart && /^\d{4}-\d{2}-\d{2}$/.test(rawStart)) start.setHours(0, 0, 0, 0)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const now = new Date()
    return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now }
  }
  return { start, end }
}

/**
 * Ortak CTE'ler. Çağıran bunu sorgunun BAŞINA koyar ve virgülle kendi CTE'sini
 * ekleyip SELECT'ini yazar:
 *
 * ```ts
 * prisma.$queryRaw`${reportScope(companyId, start, end)}, cost AS (...) SELECT ...`
 * ```
 *
 * **scope** — sayılacak satış belgeleri. `CANCELLED` (iptal) ve `CONVERTED`
 * (faturaya dönüştürülmüş fiş) hariç; fiş de fatura da dahil.
 *
 * **ref** — bir stok hareketinin HANGİ belgeye sayılacağı. Normalde hareketin
 * kendi `reference`'ı yeterli, ama fiş faturaya dönüştürüldüğünde stok hareketleri
 * FİŞTE kalır (dönüştürme stoğu tekrar işlemez) ve ciro FATURAYA geçer. Eşleme
 * olmasaydı o satışlar maliyetsiz görünür, marj yapay olarak %100 çıkardı.
 *
 * **items_net** — kalemlerin iskonto sonrası net toplamı. Fatura altı (genel)
 * iskonto kalem satırlarına yansımadığından, kalem bazlı ciroyu faturanın gerçek
 * `netAmount`'ına oranlamak için kullanılır.
 */
export function reportScope(companyId: string, start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`
    WITH scope AS (
      SELECT i.id,
             i."invoiceNo",
             i.date,
             i."isReceipt",
             i."customerId",
             i."netAmount",
             i."totalAmount",
             COALESCE(SUM(ii.quantity * ii."unitPrice" - COALESCE(ii."discountAmount", 0)), 0) AS items_net
      FROM invoices i
      LEFT JOIN invoice_items ii ON ii."invoiceId" = i.id
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND i.date >= ${start}
        AND i.date <= ${end}
      GROUP BY i.id
    ),
    ref AS (
      SELECT id AS ref_id, id AS doc_id FROM scope
      UNION ALL
      SELECT s.id AS ref_id, s."convertedInvoiceId" AS doc_id
      FROM invoices s
      WHERE s."companyId" = ${companyId}
        AND s."convertedInvoiceId" IS NOT NULL
        AND s."convertedInvoiceId" IN (SELECT id FROM scope)
    )
  `
}

/**
 * Belge başına maliyet CTE'si. `reportScope`'un ardına virgülle eklenir ve
 * ihtiyaç duyduğu `avg_cost` CTE'sini KENDİSİ getirir — çağıranın iki parçayı
 * doğru sırada dizmesi gerekmesin diye:
 *
 * ```ts
 * prisma.$queryRaw`${reportScope(c, s, e)}, ${docCostCte(c)} SELECT ...`
 * ```
 *
 * `recipe_cost` — reçeteden türeyen hareketlerin DONDURULMUŞ maliyeti
 * (`|miktar| × unitPrice`, satış anında yazıldı). PLAN.md "Adım 6": kahveye
 * sonradan zam gelse geçmiş günlerin karlılığı değişmez.
 *
 * `direct_cost` — reçetesiz satılan ürünler (şişe su, kutu kola). Bunların stok
 * hareketindeki `unitPrice` SATIŞ fiyatıdır, maliyet değil; o yüzden AVCO
 * kullanılır (lib/stock/cost.ts). Ayrı tutulur: reçete maliyeti gerçekleşmiş
 * veriye, bu satır güncel maliyete dayanıyor — aynı kefeye konamazlar.
 *
 * Maliyeti HİÇ bilinmeyen ürünler burada yine `0` sayılır (toplam bozulmasın),
 * ama sessiz kalmamak için ayrıca sayılırlar — bkz. `pricelessCte`.
 */
export function docCostCte(companyId: string): Prisma.Sql {
  return Prisma.sql`
    ${avgCostCte(companyId)},
    cost AS (
      SELECT r.doc_id,
             COALESCE(SUM(CASE WHEN m.description LIKE ${RECIPE_MARK}
                               THEN ABS(m.quantity) * COALESCE(m."unitPrice", 0) END), 0) AS recipe_cost,
             COALESCE(SUM(CASE WHEN m.description NOT LIKE ${RECIPE_MARK} AND m.type = 'OUT'
                               THEN ABS(m.quantity) * COALESCE(ac.unit_cost, 0) END), 0) AS direct_cost
      FROM stock_movements m
      JOIN ref r ON r.ref_id = m.reference
      LEFT JOIN avg_cost ac ON ac.product_id = m."productId"
      GROUP BY r.doc_id
    )
  `
}

/**
 * Maliyeti bilinmeyen ürünleri sayan sorgu (reportScope'un ardına eklenir, kendi
 * `avg_cost`'unu getirir). Tek satır döner: `cnt`.
 *
 * İki durum birden sayılır:
 *  - reçete hareketinin DONDURULMUŞ `unitPrice`'ı boş (satış anında da maliyet yoktu),
 *  - reçetesiz satışta ürünün AVCO'su yok (ne alış hareketi ne alış fiyatı).
 *
 * Gerekçe: `direct_cost`/`recipe_cost` bunları 0 sayıyor — toplamı bozmamak için
 * doğru, ama sessiz bırakılırsa kullanıcı %100 marjı gerçek sanır.
 */
export function pricelessCte(companyId: string): Prisma.Sql {
  return Prisma.sql`
    ${avgCostCte(companyId)}
    SELECT COUNT(DISTINCT m."productId") AS cnt
    FROM stock_movements m
    JOIN ref r ON r.ref_id = m.reference
    LEFT JOIN avg_cost ac ON ac.product_id = m."productId"
    WHERE m.type = 'OUT'
      AND (
        (m.description LIKE ${RECIPE_MARK} AND m."unitPrice" IS NULL)
        OR (m.description NOT LIKE ${RECIPE_MARK} AND ac.unit_cost IS NULL)
      )
  `
}

/** Prisma Decimal / bigint / string → number (raw sorgu çıktıları karışık gelir). */
export const num = (v: unknown): number => {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Belirli bir ANDA açık olan adisyonlar (Faz D — ASAMA2.md).
 *
 * `status` ANLIK bir alandır; geçmiş bir gün sorulduğunda ona bakmak yanlış
 * olurdu: dün 23:00'te açık olan masa bugün kapanmıştır ve artık `CLOSED`
 * görünür. Doğru soru zaman aralığıdır — "o an açılmıştı ve henüz kapanmamıştı".
 *
 * İptaller HARİÇ: iptal edilen adisyon ne ciroya döndü ne stok düşürdü, oysa
 * panelin tek işi "bu tutar henüz ciroya girmedi, bu mallar henüz stoktan
 * düşmedi" demek. `closedAt` iptalde de yazıldığı için (adisyonlar/[id] DELETE)
 * bugünün iptalleri zaten aralık koşuluyla eleniyor; `status` filtresi geçmiş
 * günlerde kalanları da alır.
 */
export function openTicketsWhere(companyId: string, instant: Date) {
  return {
    companyId,
    status: { not: "CANCELLED" },
    openedAt: { lte: instant },
    OR: [{ closedAt: null }, { closedAt: { gt: instant } }],
  } satisfies Prisma.RestaurantTicketWhereInput
}

export type OpenTicketSummary = {
  id: string
  code: string
  tableName: string | null
  guestCount: number | null
  openedAt: string
  /** Açılışından `instant`a kadar geçen dakika — "3 saattir açık" uyarısı için. */
  minutes: number
  itemCount: number
  /** KDV DAHİL — adisyon ekranında görünen tutarın aynısı. */
  total: number
}

/**
 * Açık adisyonları tutarlarıyla getirir. Toplam `ticketTotals` ile hesaplanır
 * (SQL'de tekrar yazılmıyor): adisyon ekranı, salon planı ve rapor aynı sayıyı
 * göstermek zorunda — ikinci bir toplama formülü er geç ayrışırdı.
 *
 * ORM ile çekiliyor çünkü açık adisyon sayısı doğası gereği küçüktür (salondaki
 * masa sayısıyla sınırlı); ham SQL'e inmenin karşılığı yok.
 */
export async function loadOpenTickets(
  db: Pick<typeof prisma, "restaurantTicket">,
  companyId: string,
  instant: Date,
): Promise<OpenTicketSummary[]> {
  const tickets = await db.restaurantTicket.findMany({
    where: openTicketsWhere(companyId, instant),
    select: {
      id: true,
      code: true,
      guestCount: true,
      openedAt: true,
      // İskonto ve kalem durumu toplamı DEĞİŞTİRİR: ikram/zayi hesaba girmez,
      // iskontolu masanın açık tutarı da indirimli olandır (bkz. ticketTotals).
      discountType: true,
      discountValue: true,
      table: { select: { name: true } },
      items: { select: { quantity: true, unitPrice: true, vatRate: true, status: true } },
    },
    orderBy: { openedAt: "asc" },
  })

  return tickets.map((t) => ({
    id: t.id,
    code: t.code,
    tableName: t.table?.name ?? null,
    guestCount: t.guestCount,
    openedAt: t.openedAt.toISOString(),
    minutes: Math.max(0, Math.round((instant.getTime() - t.openedAt.getTime()) / 60000)),
    itemCount: t.items.filter((i) => isBillableItem(i.status)).length,
    total: ticketTotals(t.items, ticketDiscountOf(t)).total,
  }))
}
