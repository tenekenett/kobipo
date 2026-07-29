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
 * Fiyatlı ağırlık yalnız `IN`/`PURCHASE` + `unitPrice IS NOT NULL` satırlardan
 * gelir; net miktar ise belgedeki TÜM satırlardan (ters hareket dahil). Böylece
 * TRANSFER ve satış hareketleri ortalamayı bozmaz, ters hareket ise götürür.
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
      SUM(CASE WHEN m.type IN ('IN', 'PURCHASE') AND m."unitPrice" IS NOT NULL
               THEN ABS(m.quantity) ELSE 0 END) AS priced_qty,
      SUM(CASE WHEN m.type IN ('IN', 'PURCHASE') AND m."unitPrice" IS NOT NULL
               THEN ABS(m.quantity) * m."unitPrice" ELSE 0 END) AS priced_value,
      SUM(m.quantity) AS net_qty
    FROM stock_movements m
    WHERE m."productId" = p.id
      AND m."companyId" = p."companyId"
      AND m.quantity <> 0
    GROUP BY COALESCE(NULLIF(m."reference", ''), m.id)
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
