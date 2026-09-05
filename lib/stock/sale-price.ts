// Gerçekleşen SATIŞ fiyatının tek tanımı — kesilmiş satış faturalarından
// türetilen ağırlıklı ortalama net birim fiyat.
//
// `lib/stock/cost.ts` (AVCO) ile KARDEŞ dosyadır; oradaki "aynı soruya dört ayrı
// cevap" hatasının satış tarafında tekrarlanmaması için baştan tek kapı olarak
// yazıldı. Bugün ikinci bir hesap zaten vardı: asistanın `zararinaSatilanlar()`
// sorgusu aynı ortalamayı kendi içinde kuruyordu — o da buraya bağlandı.
//
// Kural tek cümledir:
//   "İptal edilmemiş satış faturası kalemlerinin, satır iskontosu düşülmüş net
//    birim fiyatının miktarla ağırlıklı ortalaması; satış iadesi DÜŞÜLÜR; hiç
//    satış yoksa BİLİNMİYOR."
//
// `Product.salePrice`a YAZILMAZ. O alan LİSTE fiyatıdır ve yeni satış/teklif/menü
// onu girdi alır; gerçekleşen ortalama üstüne otomatik yazılsaydı iskontolu her
// satış liste fiyatını aşağı çeker, sonraki satış daha aşağıdan başlardı — kendini
// besleyen bir döngü. Ortalama yalnızca GÖSTERİLİR; karta yazmak kullanıcının açık
// eylemidir (ürün detayındaki "Fiyatı güncelle").
//
// `null` ile `0` ayrımı burada da kritik: hiç satılmamış ürünü 0 saymak onu
// "bedavaya satılıyor" gösterir ve marjı eksiye çevirir.

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

/** Pencerenin varsayılan genişliği (gün). */
export const DEFAULT_SALE_PERIOD_DAYS = 90

/**
 * Kalemin İŞARETİ: satış +1, satış iadesi −1.
 *
 * İade düşülmezse ortalama BRÜT satıştan çıkar: müşterinin geri verdiği mal
 * satılmış sayılır ve iade edilen tutar ciroda kalır. Yön `returnKind`ten okunur;
 * NULL satış iadesidir (sütun eklenmeden önceki iadeler — bkz. schema.prisma).
 * ALIŞ iadesi bu hesaba hiç GİRMEZ: o, maliyet tarafının konusudur.
 */
const SALE_SIGN = Prisma.sql`
  CASE WHEN i.type = 'SALES' THEN 1 ELSE -1 END
`

/**
 * Satırın NET tutarı — KDV hariç, satır iskontosu düşülmüş.
 *
 * `unitPrice` liste (brüt) birim fiyattır, iskonto ayrı sütunda durur; ikisini
 * ayırmadan ortalama alınsa iskontolu satışlar fiyatı olduğundan yüksek
 * gösterirdi. Fatura ALTI iskonto kaleme dağıtılmadığı için hesaba GİRMEZ —
 * yani gerçekleşen fiyat burada görünenden biraz DÜŞÜK olabilir, yüksek değil.
 * (Aynı kabul asistanın zarar uyarısında da geçerliydi.)
 *
 * KDV hariç olması `Product.salePrice` ile aynı ölçüde durmasını sağlar: kart da
 * net saklar (bkz. schema.prisma Product yorumu). Aksi halde "Fiyatı güncelle"
 * düğmesi KDV'li tutarı net alana yazardı.
 */
const LINE_NET = Prisma.sql`
  (ii.quantity * ii."unitPrice" - COALESCE(ii."discountAmount", 0))
`

/**
 * Hangi belgeler sayılır.
 *
 * PARA BİRİMİ ürünün kendi para birimiyle SINIRLIDIR. Fatura kalemi belgenin
 * para birimindedir (`Invoice.currency`), ürün kartı ise kendi biriminde fiyat
 * tutar. İkisi karışsaydı 100 USD'lik ve 100 TRY'lik satış aynı havuzda ortalanır
 * ve düğme karta anlamsız bir sayı yazardı. Kur çevirmek yerine ELEMEYİ
 * seçiyoruz: `Invoice.exchangeRate` belgenin kesildiği günün kuru, ürün kartı ise
 * bugünün fiyatı — ikisini çarpmak yeni bir yanlışlık üretirdi.
 */
const SALE_SCOPE = Prisma.sql`
  i."companyId" = p."companyId"
  AND ii."productId" IS NOT NULL
  AND ii.quantity > 0
  AND i.status NOT IN ('CANCELLED', 'CONVERTED')
  AND COALESCE(i.currency, 'TRY') = COALESCE(p.currency, 'TRY')
  AND (
    i.type = 'SALES'
    OR (i.type = 'RETURN' AND (i."returnKind" IS NULL OR UPPER(i."returnKind") = 'SALES'))
  )
`

/**
 * Gövde: ürün başına hem PENCERE hem TÜM ZAMAN ortalaması, tek taramada.
 *
 * İkisi birden dönüyor çünkü tek başına hiçbiri yetmiyor. Tüm zaman ortalaması
 * zamdan sonra yanıltır (iki yıl ₺100, bugün ₺150 satılan ürün ₺105 görünür);
 * pencere ise yavaş dönen üründe boş kalır — yılda üç kez satılan klima 90 günün
 * çoğunda hiç satılmamış olur. Ekran pencereyi tercih eder, boşsa tüm zamana
 * düşer ve HANGİSİNİ gösterdiğini yazar (bkz. ürün detayı "Fiyat Bilgileri").
 */
function avgSaleSelect(companyId: string, since: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT p.id AS product_id,
           SUM(CASE WHEN i.date >= ${since} THEN ${SALE_SIGN} * ii.quantity ELSE 0 END) AS period_qty,
           SUM(CASE WHEN i.date >= ${since} THEN ${SALE_SIGN} * ${LINE_NET} ELSE 0 END) AS period_net,
           SUM(${SALE_SIGN} * ii.quantity) AS all_qty,
           SUM(${SALE_SIGN} * ${LINE_NET}) AS all_net,
           MAX(CASE WHEN i.type = 'SALES' THEN i.date END) AS last_sale
    FROM products p
    JOIN invoice_items ii ON ii."productId" = p.id
    JOIN invoices i ON i.id = ii."invoiceId"
    WHERE p."companyId" = ${companyId}
      AND ${SALE_SCOPE}
  `
}

/** Ürünün gerçekleşen satış fiyatı özeti. Hiç satış yoksa ortalamalar null. */
export type AvgSalePrice = {
  /** Pencere içindeki ağırlıklı ortalama net birim fiyat; satış yoksa null. */
  periodAvg: number | null
  /** Pencerede satılan NET adet (iade düşülmüş). */
  periodQuantity: number
  /** Tüm zamanların ağırlıklı ortalaması; hiç satış yoksa null. */
  allTimeAvg: number | null
  /** Tüm zamanda satılan NET adet. */
  allTimeQuantity: number
  /** Son satış faturası tarihi; hiç satılmadıysa null. */
  lastSaleDate: Date | null
  /** Pencerenin genişliği — ekran "son N gün" yazabilsin diye taşınır. */
  periodDays: number
}

/** Miktar sıfır ya da negatifse (tamamı iade edilmiş) ortalama YOKTUR, 0 değildir. */
function toAvg(net: unknown, qty: unknown): { avg: number | null; quantity: number } {
  const quantity = qty == null ? 0 : Number(qty)
  const total = net == null ? 0 : Number(net)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { avg: null, quantity: Number.isFinite(quantity) ? Math.max(quantity, 0) : 0 }
  }
  const avg = total / quantity
  return { avg: Number.isFinite(avg) ? avg : null, quantity }
}

type AvgSaleRow = {
  product_id: string
  period_qty: unknown
  period_net: unknown
  all_qty: unknown
  all_net: unknown
  last_sale: Date | null
}

function toRow(row: AvgSaleRow, periodDays: number): AvgSalePrice {
  const period = toAvg(row.period_net, row.period_qty)
  const all = toAvg(row.all_net, row.all_qty)
  return {
    periodAvg: period.avg,
    periodQuantity: period.quantity,
    allTimeAvg: all.avg,
    allTimeQuantity: all.quantity,
    lastSaleDate: row.last_sale ?? null,
    periodDays,
  }
}

function sinceDate(periodDays: number): Date {
  const since = new Date()
  since.setDate(since.getDate() - periodDays)
  since.setHours(0, 0, 0, 0)
  return since
}

/** Hiç satılmamış ürünün boş özeti — çağıran "sorduk, cevap yok"u ayırt edebilsin. */
export function emptyAvgSalePrice(periodDays = DEFAULT_SALE_PERIOD_DAYS): AvgSalePrice {
  return {
    periodAvg: null,
    periodQuantity: 0,
    allTimeAvg: null,
    allTimeQuantity: 0,
    lastSaleDate: null,
    periodDays,
  }
}

/**
 * Ekranın gösterdiği TEK sayı: pencere doluysa o, değilse tüm zaman.
 *
 * Hangisinin geldiğini `scope` söyler — ekran etiketi ("son 90 gün" / "tüm
 * zamanlar") buradan yazılır. Etiketsiz gösterilirse iki farklı soru aynı
 * sayıymış gibi okunur.
 */
export function effectiveAvgSale(
  row: AvgSalePrice,
): { price: number; quantity: number; scope: "PERIOD" | "ALL" } | null {
  if (row.periodAvg != null && row.periodQuantity > 0) {
    return { price: row.periodAvg, quantity: row.periodQuantity, scope: "PERIOD" }
  }
  if (row.allTimeAvg != null && row.allTimeQuantity > 0) {
    return { price: row.allTimeAvg, quantity: row.allTimeQuantity, scope: "ALL" }
  }
  return null
}

/**
 * Rapor sorgularına eklenen CTE: `(product_id, avg_price, quantity)`.
 * `avgCostCte` gibi `reportScope`'un ardına virgülle eklenir.
 *
 * `fallbackToAllTime` çağırana bırakılmıştır çünkü iki farklı soru var:
 *  • GÖSTERİM (ürün kartı): "bu ürün kaça satılıyor" — pencere boşsa tüm zamana
 *    düşmek doğru, aksi halde yavaş dönen üründe kart boş kalır.
 *  • UYARI (asistanın zararına satış sinyali): "son 90 günde zararına sattım mı"
 *    — burada düşmek YANLIŞ olur; iki yıl önce bir kez zararına satılmış ürün
 *    bugünün uyarısı gibi görünür ve sinyal gürültüye boğulur.
 */
export function avgSaleCte(
  companyId: string,
  periodDays = DEFAULT_SALE_PERIOD_DAYS,
  options: { fallbackToAllTime?: boolean } = {},
): Prisma.Sql {
  const fallback = options.fallbackToAllTime !== false
  const price = fallback
    ? Prisma.sql`CASE WHEN s.period_qty > 0 THEN s.period_net / s.period_qty
                      WHEN s.all_qty > 0 THEN s.all_net / s.all_qty
                      ELSE NULL END`
    : Prisma.sql`CASE WHEN s.period_qty > 0 THEN s.period_net / s.period_qty ELSE NULL END`
  const quantity = fallback
    ? Prisma.sql`CASE WHEN s.period_qty > 0 THEN s.period_qty ELSE s.all_qty END`
    : Prisma.sql`s.period_qty`

  return Prisma.sql`
    avg_sale AS (
      SELECT s.product_id,
             ${price} AS avg_price,
             ${quantity} AS quantity
      FROM (
        ${avgSaleSelect(companyId, sinceDate(periodDays))}
        GROUP BY p.id
      ) s
    )
  `
}

/**
 * Verilen ürünlerin gerçekleşen satış fiyatı. Hiç satılmamış ürün haritada BOŞ
 * özetle durur (anahtarı yok değil — `resolveUnitCosts` ile aynı sözleşme).
 */
export async function resolveAvgSalePrices(
  companyId: string,
  productIds: string[],
  periodDays = DEFAULT_SALE_PERIOD_DAYS,
): Promise<Map<string, AvgSalePrice>> {
  const result = new Map<string, AvgSalePrice>()
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return result

  const rows = await prisma.$queryRaw<AvgSaleRow[]>(Prisma.sql`
    ${avgSaleSelect(companyId, sinceDate(periodDays))}
      AND p.id IN (${Prisma.join(ids)})
    GROUP BY p.id
  `)

  for (const row of rows) result.set(row.product_id, toRow(row, periodDays))
  // Hiç satılmamış / başka firmanın ürünü de haritada dursun.
  for (const id of ids) if (!result.has(id)) result.set(id, emptyAvgSalePrice(periodDays))

  return result
}

/**
 * Firmanın TÜM ürünleri için satış fiyatı haritası — ürün listesi ucu gibi
 * hepsini birden isteyen yerler için (`resolveAllUnitCosts` ile aynı gerekçe).
 *
 * Hiç satılmamış ürün haritada YOKTUR: liste ucu binlerce boş kayıt taşımasın
 * diye. Çağıran `?? emptyAvgSalePrice()` ile karşılar.
 */
export async function resolveAllAvgSalePrices(
  companyId: string,
  periodDays = DEFAULT_SALE_PERIOD_DAYS,
): Promise<Map<string, AvgSalePrice>> {
  const rows = await prisma.$queryRaw<AvgSaleRow[]>(Prisma.sql`
    ${avgSaleSelect(companyId, sinceDate(periodDays))}
    GROUP BY p.id
  `)

  const result = new Map<string, AvgSalePrice>()
  for (const row of rows) result.set(row.product_id, toRow(row, periodDays))
  return result
}
