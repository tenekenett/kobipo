// Restoran & Kafe raporlarının ortak sorgu iskeleti.
// Dört rapor da (karlılık, menü performansı, tüketim, gün sonu) AYNI kapsam
// tanımını kullanmak zorunda; aksi halde aynı gün için farklı ciro/maliyet
// gösterirler. Tanım bu yüzden tek dosyada duruyor.
//
// Bkz. docs/restoran/PLAN.md "Adım 6", ILERLEME.md "Adım 8".

import { Prisma } from "@prisma/client"

/** Reçeteden türeyen stok hareketlerinin işareti — satış anında yazılır. */
export const RECIPE_MARK = "%Reçete:%"

/**
 * Postgres kolonları `timestamp without time zone` ve UTC saklıyor. Gün kırılımı
 * yerel takvim gününe göre olmalı: TSİ 01:00'daki satış UTC'de bir önceki güne
 * düşer, gün sonu raporunda yanlış güne yazılırdı.
 */
export const localDay = (col: Prisma.Sql) =>
  Prisma.sql`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date`

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
 * Belge başına maliyet CTE'si (reportScope'un ardına eklenir).
 *
 * `recipe_cost` — reçeteden türeyen hareketlerin DONDURULMUŞ maliyeti
 * (`|miktar| × unitPrice`, satış anında yazıldı). PLAN.md "Adım 6": kahveye
 * sonradan zam gelse geçmiş günlerin karlılığı değişmez.
 *
 * `direct_cost` — reçetesiz satılan ürünler (şişe su, kutu kola). Bunların stok
 * hareketindeki `unitPrice` SATIŞ fiyatıdır, maliyet değil; o yüzden ürün
 * kartındaki alış fiyatı kullanılır. Ayrı tutulur: reçete maliyeti gerçekleşmiş
 * veriye, bu satır güncel alış fiyatına dayanıyor — aynı kefeye konamazlar.
 */
export const docCostCte = Prisma.sql`
  cost AS (
    SELECT r.doc_id,
           COALESCE(SUM(CASE WHEN m.description LIKE ${RECIPE_MARK}
                             THEN ABS(m.quantity) * COALESCE(m."unitPrice", 0) END), 0) AS recipe_cost,
           COALESCE(SUM(CASE WHEN m.description NOT LIKE ${RECIPE_MARK} AND m.type = 'OUT'
                             THEN ABS(m.quantity) * COALESCE(p."purchasePrice", 0) END), 0) AS direct_cost
    FROM stock_movements m
    JOIN ref r ON r.ref_id = m.reference
    LEFT JOIN products p ON p.id = m."productId"
    GROUP BY r.doc_id
  )
`

/** Prisma Decimal / bigint / string → number (raw sorgu çıktıları karışık gelir). */
export const num = (v: unknown): number => {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
