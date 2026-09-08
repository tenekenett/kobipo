/**
 * K-MUS-07 · "Cironuzun %X'i tek müşteriden geliyor."
 *
 * ── Neden kart: bu sayıyı kimse elle hesaplamıyor ───────────────────────────
 * İşletme sahibi en büyük müşterisinin kim olduğunu bilir; PAYINI bilmez.
 * "Ciromun %72'si tek firmadan" cümlesi, o firma bir çeyrek sipariş vermediğinde
 * ne olacağını bir anda görünür yapar. Kart bir hata göstermiyor — bir BAĞIMLILIK
 * gösteriyor ve ona bağlı açık bakiyeyi yanına koyuyor.
 *
 * ── Ölçüm (2026-09-07, canlı 12 aylık ciro) ────────────────────────────────
 *
 * | firma | müşteri | en büyüğün payı |
 * |---|---|---|
 * | REYPO BİLİŞİM | 7 | **%72** — ASDOĞUŞ, ₺1.000.000 ciro, açık bakiye ₺1.200.000 |
 * | EREN VİNÇ | 26 | **%48** — ÖZERLER, ₺750.000, bakiye kapalı |
 * | Reypo Medya | 7 | %35 |
 * | EREN F. PNÖMATİK | 86 | %19 |
 * | EREN FORKLİFT | 37 | %18 |
 *
 * Eşik %40 buradan seçildi: dağılımda %19 ile %48 arasında boşluk var, yani
 * "normal" ile "bağımlı" bu veride kendiliğinden ayrışıyor.
 *
 * ── EN AZ 5 MÜŞTERİ ŞARTI ──────────────────────────────────────────────────
 * Veride 1–2 müşterisi olan altı firma var ve hepsinde pay %67–100 çıkıyor.
 * Onlara "tek müşteriye bağımlısınız" demek doğru ama BEYHUDE: yeni kurulmuş ya
 * da tek işi olan bir hesapta bu, kartın söyleyebileceği en bariz cümle. Kart
 * ancak seçme şansı olan bir müşteri tabanında bilgi taşıyor.
 *
 * ── Bakiye ve ciro AYRI iki kaynaktan, ikisi de kanonik ─────────────────────
 * Ciro faturalardan (12 ay, TRY, taslak dahil — cari bakiyesinin saydığı küme),
 * açık bakiye `lib/cari/list-query.ts`ten. Bakiye için ikinci bir formül
 * yazmama kuralı K-THS-07'de konmuştu; burada da geçerli.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { fetchCustomerList } from "@/lib/cari/list-query"
// Otomasyon firma GENELİNDE çalışır: uyarı bir kullanıcının görüş alanına değil,
// işletmenin durumuna bakar — üstelik cron bağlamında oturum da yoktur.
import { CARI_VISIBILITY_ALL } from "@/lib/cari/visibility"
import { sayi, gunOnce } from "@/lib/asistan/veri/temel"

/** Bu payın altındaki yoğunlaşma kart konusu değildir. */
export const ESIK_PAY = 0.4

/** Kart ancak bu kadar müşterisi olan firmada bilgi taşır. */
export const EN_AZ_MUSTERI = 5

/** Ciro penceresi — GÜN cinsinden (12 ay). */
export const PENCERE_GUN = 365

/** Karta yazılan insan ölçüsü. */
export const PENCERE_AY = 12

export type MusteriYogunlasmasi = {
  musteriId: string
  slug: string | null
  ad: string
  yetkili: string | null
  telefon: string | null
  /** 0–1 arası pay. */
  pay: number
  ciro: number
  /** Aynı dönemde tüm müşterilerin toplam cirosu. */
  toplamCiro: number
  musteriSayisi: number
  /** Cari ekranındaki açık bakiye — pozitifse bize borçlu. */
  bakiye: number
  /** İlk üç müşterinin toplam payı — "tek müşteri mi, dar taban mı" ayrımı. */
  ilkUcPay: number
}

type Satir = { id: string; ciro: unknown }

/**
 * EŞİK KARARI — saf fonksiyon, veritabanı bilmez.
 *
 * İki eşiğin ikisi de ölçümden geldi (%40 pay, en az 5 müşteri) ve ikisi de
 * sorgunun DIŞINDA: biri değişirse sorgu hata vermez, kart ya susar ya da
 * 1-2 müşterisi olan hesaba "tek müşteriye bağımlısınız" der. Testle korunuyor.
 */
export function yogunlasmaSec(
  rows: Array<{ id: string; ciro: unknown }>
): { satirlar: Array<{ id: string; ciro: number }>; enBuyuk: { id: string; ciro: number }; pay: number; toplam: number } | null {
  if (rows.length < EN_AZ_MUSTERI) return null

  const satirlar = rows
    .map((r) => ({ id: r.id, ciro: sayi(r.ciro) }))
    .filter((r) => r.ciro > 0)
    .sort((a, b) => b.ciro - a.ciro)

  // Cirosu sıfır olanlar elendikten SONRA da beş müşteri kalmalı: dört gerçek
  // müşteri + bir boş kayıt, "seçme şansı olan taban" değildir.
  if (satirlar.length < EN_AZ_MUSTERI) return null

  const toplam = satirlar.reduce((t, r) => t + r.ciro, 0)
  if (!(toplam > 0)) return null

  const enBuyuk = satirlar[0]
  const pay = enBuyuk.ciro / toplam
  if (pay < ESIK_PAY) return null

  return { satirlar, enBuyuk, pay, toplam }
}

export async function musteriYogunlasmasi(
  companyId: string
): Promise<MusteriYogunlasmasi | null> {
  // Sınır SQL'de değil BURADA çiziliyor: `make_interval` Prisma'nın bigint
  // parametresini kabul etmiyor (aynı tuzak `vadesi-gecmis-alacak.ts` ve
  // `islenmemis-fatura.ts`te de not edilmiş; ilk yazımda buraya da düştüm ve
  // uç 42883 ile patladı). Gün sınırı kod tabanının her yerinde `gunOnce` ile
  // çiziliyor — İstanbul takvim günü → UTC 00:00.
  const sinir = gunOnce(PENCERE_GUN)

  const rows = await prisma.$queryRaw<Satir[]>(Prisma.sql`
    SELECT i."customerId" AS id,
           SUM(i."netAmount") AS ciro
    FROM invoices i
    JOIN customers c ON c.id = i."customerId"
    WHERE i."companyId" = ${companyId}
      AND i.type = 'SALES'
      -- Taslak da sayılır: cari bakiyesinin saydığı küme bu (K-MUS-06 ile aynı).
      AND i.status IN ('SENT', 'DRAFT', 'GIB_DRAFT')
      AND COALESCE(i.currency, 'TRY') = 'TRY'
      AND i.date >= ${sinir}
      AND c."archivedAt" IS NULL
    GROUP BY i."customerId"
  `)

  const secim = yogunlasmaSec(rows)
  if (!secim) return null
  const { satirlar, enBuyuk, pay, toplam } = secim

  // Kart ancak buraya gelirse cari listesini ister; eşiği aşmayan firmada
  // (ölçümde 34 firmanın 32'si) hiç sorgu açılmaz.
  const liste = await fetchCustomerList({ companyId, visibility: CARI_VISIBILITY_ALL })
  const cari = liste.items.find((c) => c.id === enBuyuk.id)
  if (!cari) return null

  return {
    musteriId: enBuyuk.id,
    slug: typeof cari.slug === "string" && cari.slug ? cari.slug : null,
    ad: cari.name,
    yetkili: typeof cari.contactPerson === "string" ? cari.contactPerson : null,
    telefon: typeof cari.phone === "string" ? cari.phone : null,
    pay,
    ciro: enBuyuk.ciro,
    toplamCiro: toplam,
    musteriSayisi: satirlar.length,
    bakiye: Number(cari.balance),
    ilkUcPay: satirlar.slice(0, 3).reduce((t, r) => t + r.ciro, 0) / toplam,
  }
}
