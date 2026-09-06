/**
 * K-STK-01 · "Bugün sipariş vermezsen N gün sonra ürünsüz kalacaksın."
 *
 * ── Neden mevcut `kritikStoklar` yetmiyor ───────────────────────────────────
 * `lib/asistan/veri/urun.ts` içindeki kritik stok sorgusu `minStockLevel`
 * ŞARTINA bağlı: kullanıcı ürün kartına minimum seviye girmemişse ürün o listeye
 * HİÇ düşmez. Yani uyarı, doldurulması en çok unutulan alana bağlı — ve pratikte
 * boş çıkıyor. Burada o alana hiç bakılmaz; üç ölçünün üçü de işletmenin zaten
 * yaptığı işlemden TÜRETİLİR:
 *
 *   hız        → son 28 günün gerçek stok çıkışı (satış + reçete + zayi)
 *   tedarik    → alış siparişinin veriliş–teslim aralığı
 *   tedarikçi  → ürünü en çok aldığın firma (alış faturalarından)
 *
 * ── Tüketim neden `stock_movements`, `invoice_items` değil ──────────────────
 * Restoranda hammadde satış faturasında GEÇMEZ; reçete üzerinden düşülür
 * (`lib/stock/recipe-expand.ts`). Fatura kalemlerinden sayarsak çekirdek kahve
 * "hiç tüketilmiyor" görünür ve kart hiç çıkmaz. Stok defteri ikisini de görür.
 *
 * TRANSFER ve ADJUSTMENT sayılmaz: depo arası taşıma tüketim değildir, sayım
 * düzeltmesi de talebi temsil etmez. `quantity` çıkışta eksi yazılıyor
 * (`adjustWarehouseStock`, delta), ABS ile mutlak tüketime çevriliyor.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { sayi, gunOnce } from "@/lib/asistan/veri/temel"

/** Günlük hızın ölçüldüğü pencere. Dört tam hafta: gün etkisi dengelenir. */
export const HIZ_PENCERESI_GUN = 28

/**
 * Tedarik süresi hiç bilinmiyorken varsayılan. Kart bunu kullandığında
 * kullanıcıya AÇIKÇA söyler ve doğru değeri sorar — sessizce tahmin etmez.
 */
export const VARSAYILAN_TEDARIK_GUN = 3

/**
 * Yedek ölçüye tavan. İki alış arası bazen aylar sürer (yılda iki kez alınan
 * ürün); onu tedarik süresi sanmak kartı sürekli açık bırakırdı.
 */
export const TEDARIK_TAVANI_GUN = 14

/** Teslim gününde sıfırlanmasın diye bir günlük emniyet. */
export const GUVENLIK_PAYI_GUN = 1

/**
 * Pencerede en az bu kadar çıkış hareketi olmalı.
 *
 * ÖLÇÜMDEN GELDİ (2026-09-06): eşiksiz sürüm, 28 günde TEK kez satılmış ürünler
 * için de kart üretiyordu — hız 0,04/gün, "sipariş ver" diyen bir kart. Ayda bir
 * satan ürünün tedarik penceresi diye bir şey yoktur; tek satış bir eğilim
 * değildir. Üç hareket, "bu ürün akıyor" demenin en ucuz ölçüsü.
 */
export const MIN_HAREKET_SAYISI = 3

/** Önerilen sipariş, tedarik süresine ek olarak bu kadar günü daha karşılar. */
export const HEDEF_KAPSAM_GUN = 14

export type TedarikKaynagi = "siparis" | "alis-araligi" | "varsayilan"

export type StokTukenmeSatiri = {
  id: string
  slug: string
  ad: string
  kod: string | null
  birim: string
  stok: number
  /** Son 28 günün günlük ortalama çıkışı. */
  gunlukHiz: number
  /** Bu hızla kaç gün yeter. */
  kalanGun: number
  tedarikGun: number
  tedarikKaynagi: TedarikKaynagi
  /** Tedarik süresi kaç gözlemden hesaplandı (0 = varsayılan kullanıldı). */
  tedarikOrnek: number
  onerilenMiktar: number
  /** Önerilen miktar kaç günlük ihtiyacı karşılar. */
  onerilenKapsamGun: number
  tedarikci: {
    id: string
    ad: string
    yetkili: string | null
    telefon: string | null
  } | null
}

type Satir = {
  id: string
  slug: string
  name: string
  code: string | null
  unit: string
  stok: unknown
  gunluk_hiz: unknown
  siparis_gun: unknown
  siparis_adet: unknown
  aralik_gun: unknown
  aralik_adet: unknown
  tedarikci_id: string | null
  tedarikci_ad: string | null
  tedarikci_yetkili: string | null
  tedarikci_telefon: string | null
}

/**
 * Tedarik penceresine giren ürünler — "kalan gün ≤ tedarik + emniyet".
 *
 * Eşik SQL'de değil TypeScript'te uygulanıyor: kaynak seçimi (sipariş / alış
 * aralığı / varsayılan) ve tavan kuralı orada okunaklı duruyor, SQL'de üç katlı
 * COALESCE'e dönerdi.
 */
export async function tedarikPenceresindekiUrunler(
  companyId: string,
  limit = 25
): Promise<StokTukenmeSatiri[]> {
  const pencereBasi = gunOnce(HIZ_PENCERESI_GUN)
  const birYilOnce = gunOnce(365)

  const rows = await prisma.$queryRaw<Satir[]>(Prisma.sql`
    WITH hiz AS (
      SELECT sm."productId" AS pid,
             SUM(ABS(sm.quantity)) / ${HIZ_PENCERESI_GUN}::numeric AS gunluk
      FROM stock_movements sm
      WHERE sm."companyId" = ${companyId}
        AND sm.type = 'OUT'
        AND sm."createdAt" >= ${pencereBasi}
      GROUP BY sm."productId"
      HAVING SUM(ABS(sm.quantity)) > 0
         AND COUNT(*) >= ${MIN_HAREKET_SAYISI}
    ),
    siparis AS (
      SELECT oi."productId" AS pid,
             AVG(EXTRACT(EPOCH FROM (o."deliveryDate" - o.date)) / 86400.0) AS gun,
             COUNT(*) AS adet
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      WHERE o."companyId" = ${companyId}
        AND o.type = 'PURCHASE'
        AND o."deliveryDate" IS NOT NULL
        AND o."deliveryDate" >= o.date
        AND oi."productId" IS NOT NULL
      GROUP BY oi."productId"
    ),
    alislar AS (
      SELECT ii."productId" AS pid, i."supplierId" AS sid, i.date AS tarih
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'PURCHASE'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND ii."productId" IS NOT NULL
        AND i.date >= ${birYilOnce}
    ),
    aralik AS (
      -- Yedek tedarik ölçüsü: aynı ürünün iki alışı arasındaki ortalama gün.
      SELECT pid, AVG(fark) AS gun, COUNT(*) AS adet
      FROM (
        SELECT pid,
               EXTRACT(EPOCH FROM (
                 tarih - LAG(tarih) OVER (PARTITION BY pid ORDER BY tarih)
               )) / 86400.0 AS fark
        FROM alislar
      ) g
      WHERE fark IS NOT NULL AND fark > 0
      GROUP BY pid
    ),
    tedarikci AS (
      -- Ürünü en çok aldığın firma; eşitlikte en yakın tarihli kazanır.
      SELECT DISTINCT ON (pid) pid, sid
      FROM (
        SELECT pid, sid, COUNT(*) AS adet, MAX(tarih) AS son
        FROM alislar
        WHERE sid IS NOT NULL
        GROUP BY pid, sid
      ) t
      ORDER BY pid, adet DESC, son DESC
    )
    SELECT p.id, p.slug, p.name, p.code, p.unit,
           p."stockQuantity" AS stok,
           h.gunluk         AS gunluk_hiz,
           s.gun            AS siparis_gun,
           s.adet           AS siparis_adet,
           a.gun            AS aralik_gun,
           a.adet           AS aralik_adet,
           sup.id           AS tedarikci_id,
           sup.name         AS tedarikci_ad,
           sup."contactPerson" AS tedarikci_yetkili,
           sup.phone        AS tedarikci_telefon
    FROM products p
    JOIN hiz h        ON h.pid = p.id
    LEFT JOIN siparis s   ON s.pid = p.id
    LEFT JOIN aralik a    ON a.pid = p.id
    LEFT JOIN tedarikci td ON td.pid = p.id
    LEFT JOIN suppliers sup ON sup.id = td.sid
    WHERE p."companyId" = ${companyId}
      AND p."isActive" = true
      AND p."isService" = false
      AND h.gunluk > 0
      -- NEGATİF STOK BU KARTIN İŞİ DEĞİL. Eksi bakiye bir tedarik sorunu değil,
      -- bir KAYIT HATASIDIR: açılış stoğu girilmemiş ya da alış işlenmemiştir.
      -- "Bugün sipariş versen bile 31 gün açıkta kalırsın" demek, kullanıcıyı
      -- olmayan bir soruna yönlendirir. Ölçümde (2026-09-06) kartların TAMAMI
      -- böyle çıktı. Doğru kart K-STK-09 (Negatif stok — kayıt hatası).
      AND p."stockQuantity" >= 0
    ORDER BY (p."stockQuantity" / h.gunluk) ASC
    LIMIT ${limit * 4}
  `)

  const sonuc: StokTukenmeSatiri[] = []

  for (const r of rows) {
    const gunlukHiz = sayi(r.gunluk_hiz)
    if (gunlukHiz <= 0) continue

    const stok = sayi(r.stok)
    const kalanGun = Math.floor(stok / gunlukHiz)

    const { tedarikGun, tedarikKaynagi, tedarikOrnek } = tedarikSuresi(r)

    // Kartın tek tetiği: teslim gelene kadar stok bitiyor mu?
    if (kalanGun > tedarikGun + GUVENLIK_PAYI_GUN) continue

    const hedefMiktar = gunlukHiz * (tedarikGun + HEDEF_KAPSAM_GUN)
    const onerilenMiktar = Math.max(Math.ceil(hedefMiktar - stok), 1)

    sonuc.push({
      id: r.id,
      slug: r.slug,
      ad: r.name,
      kod: r.code,
      birim: r.unit,
      stok,
      gunlukHiz,
      kalanGun,
      tedarikGun,
      tedarikKaynagi,
      tedarikOrnek,
      onerilenMiktar,
      onerilenKapsamGun: Math.round((stok + onerilenMiktar) / gunlukHiz),
      tedarikci: r.tedarikci_id
        ? {
            id: r.tedarikci_id,
            ad: r.tedarikci_ad ?? "",
            yetkili: r.tedarikci_yetkili,
            telefon: r.tedarikci_telefon,
          }
        : null,
    })

    if (sonuc.length >= limit) break
  }

  return sonuc
}

/**
 * Tedarik süresi ve nereden bilindiği.
 *
 * Sıra kasıtlı: gerçek sipariş–teslim ölçümü varsa o kullanılır. Yoksa alış
 * aralığı bir YAKLAŞIKLIKTIR ve kart bunu söyler; aralık genelde tedarik
 * süresinden uzun olduğu için kart erken çıkar — stoksuz kalma riskinde yanılma
 * yönü budur, tersi değil.
 */
function tedarikSuresi(r: Satir): {
  tedarikGun: number
  tedarikKaynagi: TedarikKaynagi
  tedarikOrnek: number
} {
  const siparisGun = sayi(r.siparis_gun)
  const siparisAdet = sayi(r.siparis_adet)
  if (siparisAdet > 0 && siparisGun > 0) {
    return {
      tedarikGun: Math.max(1, Math.round(siparisGun)),
      tedarikKaynagi: "siparis",
      tedarikOrnek: siparisAdet,
    }
  }

  const aralikGun = sayi(r.aralik_gun)
  const aralikAdet = sayi(r.aralik_adet)
  if (aralikAdet > 0 && aralikGun > 0) {
    return {
      tedarikGun: Math.min(TEDARIK_TAVANI_GUN, Math.max(1, Math.round(aralikGun))),
      tedarikKaynagi: "alis-araligi",
      tedarikOrnek: aralikAdet,
    }
  }

  return {
    tedarikGun: VARSAYILAN_TEDARIK_GUN,
    tedarikKaynagi: "varsayilan",
    tedarikOrnek: 0,
  }
}
