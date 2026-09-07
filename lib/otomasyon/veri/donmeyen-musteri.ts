/**
 * K-MUS-06 · "Bir kez alıp bir daha gelmeyen müşteriler — birlikte ₺X ciro."
 *
 * ── Kartın zor kısmı eşik ────────────────────────────────────────────────────
 * "30 gündür almıyor" cümlesi tek başına hiçbir şey söylemez: kahveciye 30 gün
 * uğramayan müşteri kayıptır, forklift satıcısına 30 günde bir gelen müşteri
 * SADIKTIR. Sabit bir gün sayısı, kartı sektörlerin yarısında haksız çıkarır.
 *
 * Bu yüzden eşik FİRMANIN KENDİ VERİSİNDEN türetiliyor (katalog §2, "türet"
 * kuralı): geri dönmüş müşterilerin ilk→ikinci alış aralıklarına bakılır,
 * bunların %75'lik dilimi alınır ve iki katı eşik yapılır. Yani "bu firmada
 * müşteriler tipik olarak şu kadar günde geri döner; bu kişiler onun iki katını
 * geçti" denir. Kart bu hesabı gerekçesinde AÇIKÇA yazar.
 *
 * ── Ölçüm (2026-09-07, canlı 34 firma) ve doğan üç ayar ─────────────────────
 *
 * 1. MEDYAN DEĞİL, %75'LİK DİLİM. Medyanla ölçüldüğünde EREN FORKLİFT'in ritmi
 *    3 gün çıkıyordu (tekrar eden müşterilerin çoğu aynı hafta içinde ikinci kez
 *    alıyor) ve eşik 6 güne düşüp 28 müşteriyi "kayıp" ilan ediyordu — 10 gün
 *    önce alışveriş yapmış insanlar dahil. %75'lik dilim aynı firmada 10 gün
 *    veriyor; kuyruğu görmezden gelmeyen ama tek bir yoğun haftadan da
 *    etkilenmeyen ölçü bu.
 *
 * 2. TABAN 30 GÜN. Ritmi çok sıkı olan firmada 2×p75 bile birkaç güne düşüyor;
 *    "geçen hafta alan müşteri kayıp" demek kartı ilk gün haksız çıkarırdı.
 *
 * 3. KALİBRASYON YETMİYORSA SABİT 90 GÜN. Geri dönmüş müşteri sayısı beşten
 *    azsa ritim ölçülemez (REYPO BİLİŞİM'de tek bir tekrar eden müşteri var ve
 *    ondan çıkan "1 gün" ritmi saçmadır). O firmada kart cömert bir pencereye
 *    düşer: 90 günden uzun sessizlik her işte konuşulmayı hak eder.
 *
 * Ayarlardan sonra kart 2 firmada ateşliyor:
 *   EREN F. PNÖMATİK  eşik 62 gün (p75=31, 31 tekrar eden müşteriden) → 17 müşteri · ₺171.500
 *   EREN VİNÇ         eşik 56 gün (p75=28, 5 müşteriden)             →  3 müşteri ·  ₺73.000
 * Ölçümdeki en büyük kalemler gerçek: DMN OTO ₺29.000 (65 gün, telefonu var),
 * RETEK SELÜLOZ ₺57.500 (68 gün).
 *
 * ── Cirosu sıfır olan müşteri sayılmaz ──────────────────────────────────────
 * Veride ₺0 tutarlı tek faturayla açılmış kayıtlar var ("müşteri buraya geliyo
 * mıu"). Onlar kayıp müşteri değil, deneme kaydıdır.
 *
 * ── Taslak fatura da "alım" sayılır ─────────────────────────────────────────
 * Sayım `SENT` + `DRAFT` + `GIB_DRAFT` belgeleri kapsar; cari bakiyesinin
 * kullandığı küme de bu (`lib/cari/list-query.ts`). Taslakları elemek, faturası
 * kesilmiş ama gönderilmemiş bir satışı "hiç alım yapmamış" saymak olurdu —
 * K-BLG-04 zaten o belgelerin ayrı bir sorunu olduğunu söylüyor.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { sayi } from "@/lib/asistan/veri/temel"

/** Ritim ölçülebilmesi için gereken en az "geri dönmüş müşteri" sayısı. */
export const EN_AZ_TEKRAR_EDEN = 5

/** Eşik bunun altına inemez — ritmi çok sıkı firmada haksız kart üretirdi. */
export const TABAN_GUN = 30

/** Ritim ölçülemiyorsa kullanılan cömert pencere. */
export const KALIBRASYONSUZ_GUN = 90

/** Kartta adı geçecek müşteri sayısı. */
export const ORNEK_MUSTERI_SAYISI = 3

export type DonmeyenMusteri = {
  id: string
  slug: string | null
  ad: string
  yetkili: string | null
  telefon: string | null
  /** Tek alışın üstünden geçen gün. */
  gun: number
  /** O tek alışın TRY cirosu (net). */
  ciro: number
}

export type DonmeyenMusteriOzeti = {
  adet: number
  toplamCiro: number
  esikGun: number
  /** Eşik firmanın kendi ritminden mi geldi, sabit pencereden mi? */
  kaynak: "ritim" | "sabit"
  /** Ritim kaynaklıysa: %75'lik dilim ve kaç müşteriden ölçüldüğü. */
  ritimGun: number | null
  ritimOrnek: number
  ornekler: DonmeyenMusteri[]
}

export type Satir = {
  id: string
  slug: string | null
  ad: string
  yetkili: string | null
  telefon: string | null
  adet: bigint
  ilk: Date
  ikinci: Date | null
  son: Date
  ciro: unknown
}

/**
 * Tek alım yapıp geri dönmemiş müşteriler + firmanın kendi tekrar ritmi.
 *
 * Tek sorgu: müşteri başına belge sayısı, ilk iki belge tarihi ve TRY cirosu.
 * Ritim de aynı satırlardan çıkar (ikinci alışı olanların ilk→ikinci farkı),
 * yani ikinci bir tarama yok.
 */
export async function donmeyenMusteriOzeti(
  companyId: string
): Promise<DonmeyenMusteriOzeti | null> {
  const rows = await prisma.$queryRaw<Satir[]>(Prisma.sql`
    SELECT c.id,
           NULLIF(c.slug, '')                                          AS slug,
           c.name                                                      AS ad,
           NULLIF(c."contactPerson", '')                               AS yetkili,
           NULLIF(c.phone, '')                                         AS telefon,
           COUNT(*)                                                    AS adet,
           MIN(i.date)                                                 AS ilk,
           -- İkinci belgenin tarihi: ilk tarihten büyük olanların en küçüğü.
           MIN(i.date) FILTER (WHERE i.date > (
             SELECT MIN(i2.date) FROM invoices i2
             WHERE i2."customerId" = c.id AND i2.type = 'SALES'
               AND i2.status IN ('SENT', 'DRAFT', 'GIB_DRAFT')
           ))                                                          AS ikinci,
           MAX(i.date)                                                 AS son,
           COALESCE(SUM(i."netAmount") FILTER (
             WHERE COALESCE(i.currency, 'TRY') = 'TRY'), 0)            AS ciro
    FROM invoices i
    JOIN customers c ON c.id = i."customerId"
    WHERE i."companyId" = ${companyId}
      AND i.type = 'SALES'
      AND i.status IN ('SENT', 'DRAFT', 'GIB_DRAFT')
      AND c."archivedAt" IS NULL
    GROUP BY c.id, c.slug, c.name, c."contactPerson", c.phone
  `)

  if (rows.length === 0) return null
  return donmeyenSec(rows)
}

/**
 * EŞİK VE SEÇİM — saf fonksiyon, veritabanı bilmez.
 *
 * Kartın bütün kararı burada: ritmin %75'lik dilimden hesaplanması, 30 günlük
 * taban, kalibrasyon yoksa 90 gün, ₺0'lık kaydın elenmesi. Dördü de ölçümle
 * seçildi (bkz. başlık) ve hiçbiri sorgunun içinde değil — biri değişirse
 * sorgu hata vermez, kart sessizce yanlış müşteriyi "kayıp" ilan eder.
 */
export function donmeyenSec(
  rows: Satir[],
  simdi: Date = new Date()
): DonmeyenMusteriOzeti | null {
  const gunMs = 86_400_000
  const bugun = simdi.getTime()

  // RİTİM: geri dönmüş müşterilerin ilk→ikinci alış aralıkları.
  const araliklar = rows
    .filter((r) => r.ikinci)
    .map((r) => Math.round(((r.ikinci as Date).getTime() - r.ilk.getTime()) / gunMs))
    .sort((a, b) => a - b)

  const kalibre = araliklar.length >= EN_AZ_TEKRAR_EDEN
  const p75 = kalibre ? araliklar[Math.floor(araliklar.length * 0.75)] : null
  const esikGun = kalibre ? Math.max(2 * (p75 as number), TABAN_GUN) : KALIBRASYONSUZ_GUN

  const adaylar: DonmeyenMusteri[] = []
  for (const r of rows) {
    if (Number(r.adet) !== 1) continue
    const ciro = sayi(r.ciro)
    // ₺0'lık tek belge müşteri değil, deneme kaydıdır.
    if (!(ciro > 0)) continue
    const gun = Math.floor((bugun - r.son.getTime()) / gunMs)
    if (gun <= esikGun) continue

    adaylar.push({
      id: r.id,
      slug: r.slug,
      ad: r.ad,
      yetkili: r.yetkili,
      telefon: r.telefon,
      gun,
      ciro,
    })
  }

  if (adaylar.length === 0) return null

  // En çok ciro yapmış olan önce: kart üç isim yazıyor, o üçü aranmaya en değer
  // olanlar olmalı — en eskiler değil.
  adaylar.sort((a, b) => b.ciro - a.ciro)

  return {
    adet: adaylar.length,
    toplamCiro: adaylar.reduce((t, m) => t + m.ciro, 0),
    esikGun,
    kaynak: kalibre ? "ritim" : "sabit",
    ritimGun: p75,
    ritimOrnek: araliklar.length,
    ornekler: adaylar.slice(0, ORNEK_MUSTERI_SAYISI),
  }
}
