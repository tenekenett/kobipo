/**
 * K-MUS-04 · "Aynı ürünü müşteriden müşteriye farklı fiyata satıyorsunuz."
 *
 * İşletme sahibinin elle ASLA görmediği şeylerden biri: fiyat listesi tek ama
 * uygulama dağılmıştır — biri pazarlık etmiş, biri eski fiyattan devam ediyor,
 * birine yanlış kalem seçilmiş. Fark ancak aynı ürünün farklı müşterilere giden
 * satırları yan yana konunca görünür.
 *
 * ── Kart SUÇLAMAZ, GÖSTERİR ─────────────────────────────────────────────────
 * Farkın meşru sebepleri var: hacim iskontosu, sözleşmeli müşteri, arada yapılan
 * zam. Bu yüzden kart "yanlış fiyat verdin" demez; iki ucu TARİHİYLE birlikte
 * yazar ve kararı kullanıcıya bırakır. Tarih kritik: "Ocak'ta ₺100, Ağustos'ta
 * ₺140" okuyan kişi bunun zam olduğunu anında görür.
 *
 * ── Kaçınılan iki hata ──────────────────────────────────────────────────────
 *  1. NET fiyat kullanılır (`LINE_NET`, lib/stock/sale-price.ts). Brüt
 *     `unitPrice` ile karşılaştırmak, iskontolu satışı "aynı fiyat" gösterirdi.
 *     Tanım ORADAN alınır; ikinci bir kopya iki ekranın farklı fiyat göstermesi
 *     demek olurdu.
 *  2. Müşteri başına yalnız EN SON satış karşılaştırılır. Bütün geçmişi
 *     havuzlamak, bir yıl içindeki normal fiyat hareketini "müşteri ayrımcılığı"
 *     gibi gösterirdi.
 *  3. HİZMET KALEMLERİ ELENİR. Ölçümde (2026-09-06) kartın ürettiği bulguların
 *     TAMAMI hizmetti: "VİNÇ ÇALIŞMA BEDELİ ALİ ÖNAL ₺2.000 ↔ YİĞİTALP ₺45.000,
 *     %2150 fark". Hizmette `unitPrice` işin TOPLAM bedelidir — iki saatlik vinç
 *     işiyle bir haftalık iş arasında yirmi kat fark normaldir, fiyat farkı
 *     değildir. Süzgeç eklenince bu veride kart hiç çıkmıyor; doğrusu da bu.
 *     Fiziksel üründe birim fiyat gerçekten karşılaştırılabilir bir ölçüdür.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { LINE_NET } from "@/lib/stock/sale-price"
import { sayi, gunOnce } from "@/lib/asistan/veri/temel"

/** Karşılaştırma penceresi. */
export const PENCERE_GUN = 90

/** Bu orandan büyük fark kartlık sayılır (1.25 = %25). */
export const FARK_ESIGI = 1.25

/** Kartta adı geçecek ürün sayısı. */
export const ORNEK_URUN_SAYISI = 3

export type FiyatFarkiSatiri = {
  urun: string
  ucuzMusteri: string
  ucuzFiyat: number
  ucuzTarih: Date
  pahaliMusteri: string
  pahaliFiyat: number
  pahaliTarih: Date
  /** Yüzde fark (pahalı / ucuz − 1). */
  farkYuzde: number
}

export type FiyatFarkiOzeti = {
  urunSayisi: number
  ornekler: FiyatFarkiSatiri[]
}

export async function musteriFiyatFarki(
  companyId: string
): Promise<FiyatFarkiOzeti | null> {
  const pencere = gunOnce(PENCERE_GUN)

  const rows = await prisma.$queryRaw<
    Array<{
      urun: string
      ucuz_ad: string | null
      ucuz_fiyat: unknown
      ucuz_tarih: Date
      pahali_ad: string | null
      pahali_fiyat: unknown
      pahali_tarih: Date
    }>
  >(Prisma.sql`
    WITH satirlar AS (
      SELECT i."customerId" AS cid,
             ii."productId"  AS pid,
             i.date          AS tarih,
             ${LINE_NET} / ii.quantity AS birim,
             ROW_NUMBER() OVER (
               PARTITION BY ii."productId", i."customerId" ORDER BY i.date DESC
             ) AS sira
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      JOIN products p ON p.id = ii."productId"
      WHERE i."companyId" = ${companyId}
        -- Hizmette birim fiyat = işin bedeli; müşteriler arası kıyas anlamsız.
        AND p."isService" = false
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED', 'DRAFT')
        AND ii."productId" IS NOT NULL
        AND ii.quantity > 0
        AND ii."unitPrice" > 0
        AND i."customerId" IS NOT NULL
        -- Para birimi karışırsa 100 USD ile 100 TRY aynı havuza düşer.
        AND COALESCE(i.currency, 'TRY') = 'TRY'
        AND i.date >= ${pencere}
    ),
    son AS (SELECT * FROM satirlar WHERE sira = 1 AND birim > 0),
    uclar AS (
      SELECT pid,
             MIN(birim) AS dusuk,
             MAX(birim) AS yuksek,
             (array_agg(cid   ORDER BY birim ASC))[1]  AS ucuz_cid,
             (array_agg(tarih ORDER BY birim ASC))[1]  AS ucuz_tarih,
             (array_agg(cid   ORDER BY birim DESC))[1] AS pahali_cid,
             (array_agg(tarih ORDER BY birim DESC))[1] AS pahali_tarih
      FROM son
      GROUP BY pid
      HAVING COUNT(*) >= 2
    )
    SELECT p.name AS urun,
           uc.dusuk  AS ucuz_fiyat,   uc.ucuz_tarih,
           uc.yuksek AS pahali_fiyat, uc.pahali_tarih,
           cu."name" AS ucuz_ad,
           cp."name" AS pahali_ad
    FROM uclar uc
    JOIN products p ON p.id = uc.pid
    LEFT JOIN customers cu ON cu.id = uc.ucuz_cid
    LEFT JOIN customers cp ON cp.id = uc.pahali_cid
    WHERE uc.yuksek > uc.dusuk * ${FARK_ESIGI}
    ORDER BY (uc.yuksek / uc.dusuk) DESC
  `)

  if (rows.length === 0) return null

  return {
    urunSayisi: rows.length,
    ornekler: rows.slice(0, ORNEK_URUN_SAYISI).map((r) => {
      const ucuz = sayi(r.ucuz_fiyat)
      const pahali = sayi(r.pahali_fiyat)
      return {
        urun: r.urun,
        ucuzMusteri: r.ucuz_ad ?? "—",
        ucuzFiyat: ucuz,
        ucuzTarih: r.ucuz_tarih,
        pahaliMusteri: r.pahali_ad ?? "—",
        pahaliFiyat: pahali,
        pahaliTarih: r.pahali_tarih,
        farkYuzde: Math.round((pahali / ucuz - 1) * 100),
      }
    }),
  }
}
