/**
 * Asistanın ÜRÜN tarafındaki okumaları. Hem uyarı sinyalleri hem sohbet araçları
 * buradan besleniyor — "ölü stok" kartındaki gün sayısıyla, kullanıcı aynı ürünü
 * sorduğunda modelin söylediği gün sayısı aynı sorgudan gelsin diye.
 *
 * Maliyet BURADA HESAPLANMAZ: `avgCostCte` (lib/stock/cost.ts) çağrılır. Kendi
 * maliyet formülünü yazmak, o dosyanın başlığındaki dört-ayrı-cevap hatasının
 * beşincisini eklemek olurdu — asistan "₺42.800 bağlı" derken karlılık raporu
 * başka bir rakam gösterirdi.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { avgCostCte } from "@/lib/stock/cost"
import { avgSaleCte } from "@/lib/stock/sale-price"
import { gunFarki, bugunBasi, gunOnce, sayi } from "./temel"

export type OluStokSatiri = {
  id: string
  slug: string
  ad: string
  kod: string | null
  miktar: number
  birim: string
  /** Son satış faturası tarihi; hiç satılmadıysa null. */
  sonSatis: Date | null
  /** Son stok çıkışı (reçete tüketimi, transfer, zayi dahil); yoksa null. */
  sonCikis: Date | null
  /** Hareketsiz geçen gün; hiç hareket yoksa null ("hiç satılmamış"). */
  hareketsizGun: number | null
  /** AVCO birim maliyet — bilinmiyorsa null (0 DEĞİL, bkz. lib/stock/cost.ts). */
  birimMaliyet: number | null
  /** miktar × birimMaliyet; maliyet bilinmiyorsa null. */
  bagliTutar: number | null
}

/**
 * Eşik günden beri NE SATILMIŞ NE DE STOKTAN ÇIKMIŞ, ama elinde stok duran
 * ürünler. Sıralama bağlı sermayeye göre: 400 adet vidayla 3 klima aynı uyarıda
 * yan yana durursa kullanıcı hangisine bakacağını bilemez.
 *
 * SATIŞ VE ÇIKIŞ AYRI SORULUR. Yalnız faturaya bakmak kafe/restoran firmasında
 * her hammaddeyi "3 aydır satılmadı" diye işaretlerdi: süt, kahve çekirdeği ve
 * şurup hiçbir zaman fatura kalemi olmaz, reçeteyle stoktan düşer. Çıkış
 * hareketi olan ürün hareketsiz sayılmaz.
 */
export async function oluStoklar(
  companyId: string,
  gunEsigi = 90,
  limit = 25
): Promise<OluStokSatiri[]> {
  const esik = gunOnce(gunEsigi)
  const bugun = bugunBasi()

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      slug: string
      name: string
      code: string | null
      unit: string
      miktar: unknown
      son_satis: Date | null
      son_cikis: Date | null
      unit_cost: unknown
    }>
  >(Prisma.sql`
    WITH ${avgCostCte(companyId)},
    son_satis AS (
      SELECT ii."productId" AS pid, MAX(i.date) AS tarih
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND ii."productId" IS NOT NULL
      GROUP BY ii."productId"
    ),
    son_cikis AS (
      SELECT m."productId" AS pid, MAX(m."createdAt") AS tarih
      FROM stock_movements m
      WHERE m."companyId" = ${companyId}
        AND m.quantity < 0
      GROUP BY m."productId"
    )
    SELECT p.id, p.slug, p.name, p.code, p.unit,
           p."stockQuantity" AS miktar,
           s.tarih AS son_satis,
           c.tarih AS son_cikis,
           ac.unit_cost
    FROM products p
    LEFT JOIN son_satis s ON s.pid = p.id
    LEFT JOIN son_cikis c ON c.pid = p.id
    LEFT JOIN avg_cost ac ON ac.product_id = p.id
    WHERE p."companyId" = ${companyId}
      AND p."isActive" = true
      AND p."isService" = false
      AND p."stockQuantity" > 0
      AND (s.tarih IS NULL OR s.tarih < ${esik})
      AND (c.tarih IS NULL OR c.tarih < ${esik})
    ORDER BY p."stockQuantity" * COALESCE(ac.unit_cost, 0) DESC,
             p."stockQuantity" DESC
    LIMIT ${limit}
  `)

  return rows.map((r) => {
    const sonSatis = r.son_satis ?? null
    const sonCikis = r.son_cikis ?? null
    const sonHareket =
      sonSatis && sonCikis ? (sonSatis > sonCikis ? sonSatis : sonCikis) : (sonSatis ?? sonCikis)
    const birimMaliyet = r.unit_cost == null ? null : sayi(r.unit_cost)
    const miktar = sayi(r.miktar)
    return {
      id: r.id,
      slug: r.slug,
      ad: r.name,
      kod: r.code,
      miktar,
      birim: r.unit,
      sonSatis,
      sonCikis,
      hareketsizGun: sonHareket ? gunFarki(bugun, sonHareket) : null,
      birimMaliyet,
      bagliTutar: birimMaliyet == null ? null : miktar * birimMaliyet,
    }
  })
}

export type KritikStokSatiri = {
  id: string
  slug: string
  ad: string
  kod: string | null
  miktar: number
  birim: string
  minSeviye: number
  /** Son 30 günün günlük ortalama satış hızı (adet/gün). */
  gunlukHiz: number
  /** Eldeki stok kaç gün yeter? Hız sıfırsa null. */
  kalanGun: number | null
}

/**
 * Minimum seviyenin altına düşmüş ürünler + eldeki stoğun kaç gün yeteceği.
 *
 * "Kaç gün kaldı" olmadan uyarı eksik kalıyor: minimum seviye çoğu firmada bir
 * kez girilip unutulmuş bir sayı. Satış hızıyla birlikte gösterilince
 * "minimumun altında ama 40 gün yeter" ile "minimumun altında ve 2 gün sonra
 * bitiyor" ayrışır — sipariş kararını verdiren ikincisidir.
 */
export async function kritikStoklar(
  companyId: string,
  limit = 25
): Promise<KritikStokSatiri[]> {
  const otuzGun = gunOnce(30)

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      slug: string
      name: string
      code: string | null
      unit: string
      miktar: unknown
      min_seviye: unknown
      satilan: unknown
    }>
  >(Prisma.sql`
    WITH son_30 AS (
      SELECT ii."productId" AS pid, SUM(ii.quantity) AS adet
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND i.date >= ${otuzGun}
        AND ii."productId" IS NOT NULL
      GROUP BY ii."productId"
    )
    SELECT p.id, p.slug, p.name, p.code, p.unit,
           p."stockQuantity" AS miktar,
           p."minStockLevel" AS min_seviye,
           COALESCE(s.adet, 0) AS satilan
    FROM products p
    LEFT JOIN son_30 s ON s.pid = p.id
    WHERE p."companyId" = ${companyId}
      AND p."isActive" = true
      AND p."isService" = false
      AND p."minStockLevel" IS NOT NULL
      AND p."minStockLevel" > 0
      AND p."stockQuantity" <= p."minStockLevel"
    ORDER BY (p."stockQuantity" / NULLIF(p."minStockLevel", 0)) ASC
    LIMIT ${limit}
  `)

  return rows.map((r) => {
    const miktar = sayi(r.miktar)
    const gunlukHiz = sayi(r.satilan) / 30
    return {
      id: r.id,
      slug: r.slug,
      ad: r.name,
      kod: r.code,
      miktar,
      birim: r.unit,
      minSeviye: sayi(r.min_seviye),
      gunlukHiz,
      kalanGun: gunlukHiz > 0 ? Math.floor(miktar / gunlukHiz) : null,
    }
  })
}

export type ZararinaSatisSatiri = {
  id: string
  slug: string
  ad: string
  kod: string | null
  /** Dönemdeki ortalama net birim satış fiyatı (satır iskontosu düşülmüş). */
  ortSatis: number
  birimMaliyet: number
  /** Birim başına zarar (pozitif sayı). */
  birimZarar: number
  adet: number
  /** adet × birimZarar — dönemin toplam kaybı. */
  toplamZarar: number
}

/**
 * Maliyetinin ALTINA satılan ürünler.
 *
 * Maliyet AVCO'dan (bugünkü ağırlıklı ortalama), satış fiyatı ise dönemin
 * gerçekleşen kalemlerinden gelir. Bu bir YAKLAŞIMDIR: alış fiyatı dönem içinde
 * zamlandıysa, satış anında kârlı olan bir satır bugün zararda görünebilir.
 * Kabul edilir, çünkü sorulan soru "geçmişte kâr ettim mi" değil "bu fiyatla
 * satmaya devam edersem ne olur" — ve onun doğru maliyeti bugünkü maliyettir.
 * Model bu ayrımı cümleye koymak zorunda (bkz. lib/asistan/prompt.ts).
 *
 * Satır iskontosu düşülür; fatura ALTI iskonto kaleme dağıtılmadığı için hesaba
 * GİRMEZ — yani gerçek zarar burada görünenden biraz daha büyük olabilir, küçük
 * değil. Uyarının yönü güvenli tarafta kalır.
 *
 * Satış ortalaması BURADA HESAPLANMAZ: `avgSaleCte` (lib/stock/sale-price.ts)
 * çağrılır — maliyette olduğu gibi. Formül eskiden bu sorgunun içinde duruyordu
 * ve ürün kartındaki "ort. satış" ile bu uyarının fiyatı ayrışabilirdi.
 * `fallbackToAllTime: false` bilinçli: soru "SON 90 günde zararına sattım mı",
 * pencere boşsa cevap "hayır"dır — tüm zamana düşmek iki yıl önceki tek bir
 * satışı bugünün uyarısı yapardı.
 */
export async function zararinaSatilanlar(
  companyId: string,
  gunSayisi = 90,
  limit = 20
): Promise<ZararinaSatisSatiri[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      slug: string
      name: string
      code: string | null
      adet: unknown
      ort_satis: unknown
      unit_cost: unknown
    }>
  >(Prisma.sql`
    WITH ${avgCostCte(companyId)},
    ${avgSaleCte(companyId, gunSayisi, { fallbackToAllTime: false })}
    SELECT p.id, p.slug, p.name, p.code,
           s.quantity AS adet, s.avg_price AS ort_satis, ac.unit_cost
    FROM avg_sale s
    JOIN products p ON p.id = s.product_id
    JOIN avg_cost ac ON ac.product_id = p.id
    WHERE ac.unit_cost IS NOT NULL
      AND s.avg_price IS NOT NULL
      AND s.quantity > 0
      AND s.avg_price < ac.unit_cost
    ORDER BY (ac.unit_cost - s.avg_price) * s.quantity DESC
    LIMIT ${limit}
  `)

  return rows.map((r) => {
    const adet = sayi(r.adet)
    const ortSatis = sayi(r.ort_satis)
    const birimMaliyet = sayi(r.unit_cost)
    const birimZarar = birimMaliyet - ortSatis
    return {
      id: r.id,
      slug: r.slug,
      ad: r.name,
      kod: r.code,
      ortSatis,
      birimMaliyet,
      birimZarar,
      adet,
      toplamZarar: birimZarar * adet,
    }
  })
}

export type UrunKarti = {
  id: string
  slug: string
  ad: string
  kod: string | null
  barkod: string | null
  kategori: string | null
  birim: string
  stok: number
  minSeviye: number | null
  satisFiyati: number | null
  birimMaliyet: number | null
  sonSatis: Date | null
  /** Verilen dönemde satılan adet ve net ciro. */
  donemAdet: number
  donemCiro: number
}

/**
 * Ada / koda / barkoda göre ürün arar ve dönem satışını birlikte döner.
 *
 * Model ürünü ADIYLA soruyor ("klimadan kaç tane sattık"); id'yi bilmiyor. Arama
 * ve satış özetini TEK araçta birleştirmek bir tur tasarruf ettiriyor — ayrı
 * olsaydı model önce arar, sonra id'yi ikinci araca verirdi ve her soru iki tur
 * (iki istek, iki kat gecikme) ederdi.
 */
export async function urunAra(
  companyId: string,
  sorgu: string,
  baslangic: Date,
  bitis: Date,
  limit = 10
): Promise<UrunKarti[]> {
  const like = `%${sorgu.trim()}%`

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      slug: string
      name: string
      code: string | null
      barcode: string | null
      category: string | null
      unit: string
      stok: unknown
      min_seviye: unknown
      satis_fiyati: unknown
      unit_cost: unknown
      son_satis: Date | null
      donem_adet: unknown
      donem_ciro: unknown
    }>
  >(Prisma.sql`
    WITH ${avgCostCte(companyId)},
    donem AS (
      SELECT ii."productId" AS pid,
             SUM(ii.quantity) AS adet,
             SUM(ii.quantity * ii."unitPrice" - COALESCE(ii."discountAmount", 0)) AS ciro
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND i.date >= ${baslangic}
        AND i.date < ${bitis}
        AND ii."productId" IS NOT NULL
      GROUP BY ii."productId"
    ),
    son AS (
      SELECT ii."productId" AS pid, MAX(i.date) AS tarih
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND ii."productId" IS NOT NULL
      GROUP BY ii."productId"
    )
    SELECT p.id, p.slug, p.name, p.code, p.barcode, p.category, p.unit,
           p."stockQuantity" AS stok,
           p."minStockLevel" AS min_seviye,
           p."salePrice" AS satis_fiyati,
           ac.unit_cost,
           s.tarih AS son_satis,
           COALESCE(d.adet, 0) AS donem_adet,
           COALESCE(d.ciro, 0) AS donem_ciro
    FROM products p
    LEFT JOIN avg_cost ac ON ac.product_id = p.id
    LEFT JOIN donem d ON d.pid = p.id
    LEFT JOIN son s ON s.pid = p.id
    WHERE p."companyId" = ${companyId}
      AND p."isActive" = true
      AND (p.name ILIKE ${like} OR p.code ILIKE ${like} OR p.barcode ILIKE ${like})
    ORDER BY COALESCE(d.ciro, 0) DESC, p.name ASC
    LIMIT ${limit}
  `)

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    ad: r.name,
    kod: r.code,
    barkod: r.barcode,
    kategori: r.category,
    birim: r.unit,
    stok: sayi(r.stok),
    minSeviye: r.min_seviye == null ? null : sayi(r.min_seviye),
    satisFiyati: r.satis_fiyati == null ? null : sayi(r.satis_fiyati),
    birimMaliyet: r.unit_cost == null ? null : sayi(r.unit_cost),
    sonSatis: r.son_satis ?? null,
    donemAdet: sayi(r.donem_adet),
    donemCiro: sayi(r.donem_ciro),
  }))
}

export type SatisSiralamaSatiri = {
  id: string
  slug: string
  ad: string
  kod: string | null
  adet: number
  ciro: number
  /** Brüt kâr (ciro − adet × AVCO maliyet); maliyet bilinmiyorsa null. */
  brutKar: number | null
  marjYuzde: number | null
}

/**
 * Dönemin en çok satan / en çok kazandıran ürünleri.
 *
 * `olcut` cirodan mı kârdan mı sıralanacağını söyler. İkisi AYNI ARAÇTA çünkü
 * "en çok satan ürünüm hangisi" ile "en çok kazandıranım hangisi" arasındaki
 * farkı göstermek bu asistanın en işe yarar cevaplarından biri — ayrı araçlar
 * olsaydı model ikisini birden çağırmayı çoğu zaman düşünmezdi.
 */
export async function satisSiralamasi(
  companyId: string,
  baslangic: Date,
  bitis: Date,
  olcut: "ciro" | "kar" | "adet" = "ciro",
  limit = 10,
  artan = false
): Promise<SatisSiralamaSatiri[]> {
  const yon = artan ? Prisma.sql`ASC` : Prisma.sql`DESC`
  const siralama =
    olcut === "adet"
      ? Prisma.sql`k.adet ${yon}`
      : olcut === "kar"
        ? Prisma.sql`(k.ciro - k.adet * COALESCE(ac.unit_cost, 0)) ${yon}`
        : Prisma.sql`k.ciro ${yon}`

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      slug: string
      name: string
      code: string | null
      adet: unknown
      ciro: unknown
      unit_cost: unknown
    }>
  >(Prisma.sql`
    WITH ${avgCostCte(companyId)},
    k AS (
      SELECT ii."productId" AS pid,
             SUM(ii.quantity) AS adet,
             SUM(ii.quantity * ii."unitPrice" - COALESCE(ii."discountAmount", 0)) AS ciro
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND i.date >= ${baslangic}
        AND i.date < ${bitis}
        AND ii."productId" IS NOT NULL
      GROUP BY ii."productId"
    )
    SELECT p.id, p.slug, p.name, p.code, k.adet, k.ciro, ac.unit_cost
    FROM k
    JOIN products p ON p.id = k.pid
    LEFT JOIN avg_cost ac ON ac.product_id = p.id
    WHERE p."companyId" = ${companyId}
    ORDER BY ${siralama}
    LIMIT ${limit}
  `)

  return rows.map((r) => {
    const adet = sayi(r.adet)
    const ciro = sayi(r.ciro)
    const maliyet = r.unit_cost == null ? null : sayi(r.unit_cost)
    const brutKar = maliyet == null ? null : ciro - adet * maliyet
    return {
      id: r.id,
      slug: r.slug,
      ad: r.name,
      kod: r.code,
      adet,
      ciro,
      brutKar,
      marjYuzde: brutKar == null || ciro === 0 ? null : (brutKar / ciro) * 100,
    }
  })
}
