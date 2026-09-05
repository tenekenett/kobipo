// Birim maliyetin TEK tanımı — AVCO (ağırlıklı ortalama alış maliyeti).
//
// Bu dosya var olmadan önce aynı soruya dört ayrı cevap vardı ve ikisi aynı
// girdileri TERS öncelikle kullanıyordu:
//   • reçete ekranı      avgPurchasePrice → purchasePrice
//   • satışta dondurma   purchasePrice    → son alış hareketi
//   • karlılık raporu    purchasePrice    (fallback yok → maliyetsiz ürün, %100 marj)
//   • menü performansı   gerçekleşen ağırlıklı → yukarıdaki satır
// Sonuç: reçete ekranındaki marj ile karlılık raporundaki marj, alış fiyatı
// dalgalandığı anda ayrışıyordu. Bkz. docs/restoran/SADELESTIRME.md "İş 2".
//
// Kural tek cümledir:
//   "Fiyatı kayıtlı ve GERİ ALINMAMIŞ alış hareketlerinin miktarla ağırlıklı
//    ortalaması; hiç hareket yoksa elle girilen alış fiyatı; o da yoksa BİLİNMİYOR."
//
// "Geri alınmamış" kısmı sonradan eklendi: iptal/silinen alışın fiyatı ortalamada
// kalıyordu (bkz. AVG_COST_SELECT yorumu ve docs/restoran/SADELESTIRME.md "İş 11").
//
// "ALIŞ hareketi"nin sınırı da sonradan daraldı — fiyatlı her `IN` alış DEĞİLDİR:
//   • SATIŞ İADESİ stoğa `IN` olarak, müşteriden aldığımız SATIŞ fiyatıyla girer
//     (lib/stock/invoice-stock.ts). O fiyat maliyet değildir; ortalamaya karışınca
//     maliyeti satış fiyatına doğru şişiriyordu — yani iade alan firma kendini
//     olduğundan kârsız görüyordu. Artık ağırlığa girmez: iade edilen mal o anki
//     ortalama maliyetle değerlenir, doğrusu budur.
//   • BAŞKA PARA BİRİMİNDEKİ belgenin fiyatı da girmez. Hareket, kaynak belgenin
//     para birimindedir (`stock_movements`ta currency yok) ve kart kendi biriminde
//     fiyat tutar; 100 USD'lik alışı 100 TRY'lik alışla ortalamak yeni bir yanlış
//     üretirdi. Kur çevirmek yerine eleniyor — belge kuru geçmişin, kart bugünün.
//     (Aynı kural satış tarafında da geçerli: lib/stock/sale-price.ts.)
//
// `null` ile `0` ayrımı kritik: maliyeti bilinmeyen ürünü 0 saymak onu bedava
// gösterir ve marjı %100'e fırlatır. Çağıranlar null'ı sayıya çevirmek yerine
// "eksik maliyet" olarak RAPORLAMALI.

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

/**
 * AVCO ifadesinin gövdesi. Hem raw rapor sorguları (`avgCostCte`) hem de TS
 * tarafı (`resolveUnitCosts`) BUNU kullanır — iki tanımın zamanla ayrışmaması
 * için tek parça olarak duruyor.
 *
 * Ağırlık BELGE bazında hesaplanır (`LEFT JOIN LATERAL` + `GROUP BY doc_key`).
 * Sebebi: iptal/silme, alış hareketini SİLMEZ — aynı `reference` ile FİYATSIZ bir
 * ters hareket yazar (`revertStockByReference`). Ters hareket fiyatsız olduğu için
 * eski "hepsini topla" sorgusunda görünmüyordu ve **iptal edilmiş alış ortalamaya
 * girmeye devam ediyordu**. Belge içindeki NET miktara bakınca ters hareket
 * kendiliğinden sayılıyor: net 0 ise o belgenin ağırlığı da 0 olur.
 *
 * Bu, belge kaydı ortada olmasa da çalışır — fatura silindiğinde `stock_movements`
 * satırları `reference`'ı artık var olmayan bir id'yi gösterecek şekilde kalır;
 * hesap yalnızca hareketlere baktığı için iptal ile silme aynı sonucu verir.
 *
 * `doc_key`: `reference` (boşsa hareketin kendi id'si — referanssız elle girilen
 * hareketler tek tek kendi belgesi sayılır, birbirini götürmesinler diye).
 *
 * Fiyatlı ağırlık yalnız `counts_as_purchase` satırlardan gelir; net miktar ise
 * belgedeki TÜM satırlardan (ters hareket dahil). Böylece TRANSFER ve satış
 * hareketleri ortalamayı bozmaz, ters hareket ise götürür.
 *
 * `counts_as_purchase` bayrağı satır bazında hesaplanıp GRUPLAMAYA girer; koşulu
 * iki toplamın içine kopyalamak yerine tek yerde durması, ikisinin zamanla
 * ayrışmasını engelliyor (biri filtreleyip öteki filtrelemezse ortalama bölme
 * hatası verir, sessizce yanlış çıkar). Kaynak belge `reference` üzerinden LEFT
 * JOIN'lenir: eşleşme YOKSA (irsaliye, adisyon, elle fiş, silinmiş fatura) satır
 * alış sayılmaya DEVAM eder — `COALESCE(..., FALSE)` bunun içindir; NULL'ı
 * dışlamak elle girilen tüm alış fişlerini ortalamadan düşürürdü.
 *
 * `LEAST/GREATEST`: kısmi geri alma (fatura düzenlenip miktar düşürülmüş) hâlinde
 * ağırlık kalan miktara iner; aşırı geri alma negatife düşmez.
 *
 * Hiç fiyatlı alış kalmazsa bölme null olur ve `purchasePrice` devreye girer;
 * o da yoksa sonuç null kalır.
 */
const AVG_COST_SELECT = Prisma.sql`
  SELECT p.id AS product_id,
         COALESCE(
           SUM(
             CASE WHEN d.priced_qty > 0
                  THEN LEAST(d.priced_qty, GREATEST(d.net_qty, 0)) * d.priced_value / d.priced_qty
                  ELSE 0 END
           )
           / NULLIF(
               SUM(
                 CASE WHEN d.priced_qty > 0
                      THEN LEAST(d.priced_qty, GREATEST(d.net_qty, 0))
                      ELSE 0 END
               ), 0),
           p."purchasePrice"
         ) AS unit_cost
  FROM products p
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN mm.counts_as_purchase THEN ABS(mm.quantity) ELSE 0 END) AS priced_qty,
      SUM(CASE WHEN mm.counts_as_purchase THEN ABS(mm.quantity) * mm."unitPrice" ELSE 0 END) AS priced_value,
      SUM(mm.quantity) AS net_qty
    FROM (
      SELECT m.quantity,
             m."unitPrice",
             COALESCE(NULLIF(m."reference", ''), m.id) AS doc_key,
             (
               m.type IN ('IN', 'PURCHASE')
               AND m."unitPrice" IS NOT NULL
               AND NOT COALESCE(
                     src.type = 'RETURN'
                     AND (src."returnKind" IS NULL OR UPPER(src."returnKind") = 'SALES'),
                     FALSE
                   )
               AND COALESCE(src.currency, COALESCE(p.currency, 'TRY')) = COALESCE(p.currency, 'TRY')
             ) AS counts_as_purchase
      FROM stock_movements m
      LEFT JOIN invoices src ON src.id = NULLIF(m."reference", '')
      WHERE m."productId" = p.id
        AND m."companyId" = p."companyId"
        AND m.quantity <> 0
    ) mm
    GROUP BY mm.doc_key
  ) d ON TRUE
`

/**
 * Rapor sorgularına eklenen CTE: `(product_id, unit_cost)`.
 *
 * `reportScope`'un ardına virgülle eklenir ve KENDİSİNE bağımlı CTE'lerden
 * (ör. `docCostCte`) önce gelmelidir:
 *
 * ```ts
 * prisma.$queryRaw`${reportScope(c, s, e)}, ${avgCostCte(c)}, ${docCostCte} SELECT ...`
 * ```
 */
export function avgCostCte(companyId: string): Prisma.Sql {
  return Prisma.sql`
    avg_cost AS (
      ${AVG_COST_SELECT}
      WHERE p."companyId" = ${companyId}
      GROUP BY p.id, p."purchasePrice"
    )
  `
}

/**
 * Verilen ürünlerin birim maliyeti. Maliyeti bilinmeyen ürün haritada `null`
 * ile durur (anahtarı YOK değil — "sorduk, cevap yok" ile "hiç sormadık" ayrımı
 * çağıran tarafta lazım oluyor).
 *
 * Tek `GROUP BY` sorgusu: eski hâli tüm alış hareketlerini belleğe çekip JS'te
 * topluyordu ve hareket tablosu her satışla büyüdüğü için sınırsız yavaşlıyordu.
 */
export async function resolveUnitCosts(
  companyId: string,
  productIds: string[],
): Promise<Map<string, number | null>> {
  const costs = new Map<string, number | null>()
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return costs

  const rows = await prisma.$queryRaw<Array<{ product_id: string; unit_cost: unknown }>>`
    ${AVG_COST_SELECT}
    WHERE p."companyId" = ${companyId}
      AND p.id IN (${Prisma.join(ids)})
    GROUP BY p.id, p."purchasePrice"
  `

  for (const row of rows) {
    const value = row.unit_cost == null ? null : Number(row.unit_cost)
    costs.set(row.product_id, value != null && Number.isFinite(value) ? value : null)
  }
  // Sorguya hiç düşmeyen id'ler (başka firmanın ürünü / silinmiş) de null olsun.
  for (const id of ids) if (!costs.has(id)) costs.set(id, null)

  return costs
}

/** Ürünün fiyatı kayıtlı SON alış hareketi. */
export type LastPurchase = {
  unitPrice: number
  date: Date
}

/**
 * Fiyatı kayıtlı son alış hareketleri.
 *
 * Ortalamanın YERİNE geçmez, YANINDA durur: ürün detayı "ort. maliyet ₺42 ama en
 * son ₺55'e aldın" diyebilsin diye. Tedarikçi zam yaptığında AVCO zammı ancak
 * eski stok eridikçe yansıtır — arada kullanıcı iki sayının neden ayrıştığını
 * göremezse ortalamayı hatalı sanır.
 *
 * `AVG_COST_SELECT` ile aynı DIŞLAMALARI uygular (satış iadesi ve yabancı para
 * belgesi alış sayılmaz) ama belge bazında NETLEŞTİRMEZ: burada sorulan "en son ne
 * ödedim", "elimdeki mal kaça mal oldu" değil. Geri alınmış bir alış son hareket
 * olarak görünebilir; ortalamadan düştüğü için hesabı bozmaz, yalnız bilgi satırı
 * biraz eski kalır.
 *
 * Dışlamalar burada da geçerli olmasa kart kendi içinde çelişirdi: ortalamaya
 * girmeyen bir satış iadesi "Son alış ₺3.048" diye yazılır, kullanıcı ortalamayı
 * hatalı sanardı.
 */
export async function resolveLastPurchases(
  companyId: string,
  productIds: string[],
): Promise<Map<string, LastPurchase>> {
  const result = new Map<string, LastPurchase>()
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return result

  const rows = await prisma.$queryRaw<
    Array<{ product_id: string; unit_price: unknown; created_at: Date }>
  >`
    SELECT DISTINCT ON (m."productId")
           m."productId" AS product_id,
           m."unitPrice" AS unit_price,
           m."createdAt" AS created_at
    FROM stock_movements m
    LEFT JOIN invoices src ON src.id = NULLIF(m."reference", '')
    LEFT JOIN products pr ON pr.id = m."productId"
    WHERE m."companyId" = ${companyId}
      AND m."productId" IN (${Prisma.join(ids)})
      AND m.type IN ('IN', 'PURCHASE')
      AND m."unitPrice" IS NOT NULL
      AND m.quantity <> 0
      AND NOT COALESCE(
            src.type = 'RETURN'
            AND (src."returnKind" IS NULL OR UPPER(src."returnKind") = 'SALES'),
            FALSE
          )
      AND COALESCE(src.currency, COALESCE(pr.currency, 'TRY')) = COALESCE(pr.currency, 'TRY')
    ORDER BY m."productId", m."createdAt" DESC
  `

  for (const row of rows) {
    const price = Number(row.unit_price)
    if (Number.isFinite(price)) result.set(row.product_id, { unitPrice: price, date: row.created_at })
  }
  return result
}

/**
 * Firmanın TÜM ürünleri için maliyet haritası — ürün listesi ucu gibi hepsini
 * birden isteyen yerler için (`resolveUnitCosts`'a binlerce id göndermeye gerek
 * kalmasın diye ayrı).
 */
export async function resolveAllUnitCosts(
  companyId: string,
): Promise<Map<string, number | null>> {
  const rows = await prisma.$queryRaw<Array<{ product_id: string; unit_cost: unknown }>>`
    ${AVG_COST_SELECT}
    WHERE p."companyId" = ${companyId}
    GROUP BY p.id, p."purchasePrice"
  `

  const costs = new Map<string, number | null>()
  for (const row of rows) {
    const value = row.unit_cost == null ? null : Number(row.unit_cost)
    costs.set(row.product_id, value != null && Number.isFinite(value) ? value : null)
  }
  return costs
}
