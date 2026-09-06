/**
 * K-STK-09 · "N üründe stok eksi görünüyor — satış işlenmiş, alış işlenmemiş."
 *
 * ── Neden bu kart K-STK-01'den ÖNCE geliyor ─────────────────────────────────
 * 2026-09-06 ölçümünde son 28 günde hareket gören 61 üründen 43'ünün stoğu
 * EKSİYDİ. Eksi bakiye bir tedarik sorunu değil, bir kayıt boşluğudur: satış
 * işlenmiş, alış ya da açılış stoğu hiç girilmemiştir. O boşluk kapanmadan
 * "kaç gün sonra biter" sorusunun zemini yok — tükenme kartı ya hiç çıkmaz ya
 * da saçmalar. Ayrıntı: docs/otomasyonlar/KATALOG.md §4.1 ölçüm kutusu.
 *
 * ── Kart neden ÜRÜN başına değil, FİRMA başına ──────────────────────────────
 * Tek firmada 43 ürün var. Her birine kart açmak panoyu tek konuyla doldururdu
 * ve karar sayısını 43'e çıkarırdı — oysa karar TEK: "eksik alışları işle".
 * Bu yüzden öznesi firmadır (`ozneTuru: "company"`) ve en ağır birkaç ürün
 * gerekçe içinde örnek olarak geçer.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { sayi } from "@/lib/asistan/veri/temel"

/** Gerekçede örnek olarak adı geçecek ürün sayısı. */
export const ORNEK_URUN_SAYISI = 3

export type NegatifStokSatiri = {
  id: string
  slug: string
  ad: string
  birim: string
  /** Eksi bakiye, POZİTİF sayı olarak (ekranda "-264" değil "264 adet açık"). */
  acik: number
}

export type NegatifStokOzeti = {
  urunSayisi: number
  /** Tüm eksi bakiyelerin mutlak toplamı. */
  toplamAcik: number
  /**
   * Bunların kaçında HİÇ alış faturası kalemi yok.
   *
   * Teşhisi ayıran ölçü: alışı hiç girilmemiş ürün ile "girilmiş ama eksik
   * girilmiş" ürün farklı işlerdir. Kart hangisi ağır basıyorsa onu söyler.
   */
  hicAlisiOlmayan: number
  ornekler: NegatifStokSatiri[]
}

/**
 * Eksi bakiyeli ürünlerin özeti. Kart çıkmayacaksa `null` döner.
 *
 * Hizmet kalemleri elenir: `isService` üründe stok ANLAMSIZDIR, bakiyesi eksi
 * görünse bile bu bir kayıt hatası değildir.
 */
export async function negatifStokOzeti(companyId: string): Promise<NegatifStokOzeti | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      slug: string
      name: string
      unit: string
      stok: unknown
      alis_kalemi: bigint
    }>
  >(Prisma.sql`
    SELECT p.id, p.slug, p.name, p.unit,
           p."stockQuantity" AS stok,
           -- ii.id DEGIL i.id sayilir: PURCHASE sarti invoices JOIN'inde durur,
           -- satis kaleminde ii satiri yine var ama i NULL kalir. ii.id saymak
           -- satislari alis sanardi ve teshis cumlesi HEP "alislar girilmis"
           -- derdi -- ilk olcumde (2026-09-06) tam olarak bu oldu.
           COUNT(i.id) AS alis_kalemi
    FROM products p
    LEFT JOIN invoice_items ii ON ii."productId" = p.id
    LEFT JOIN invoices i
           ON i.id = ii."invoiceId"
          AND i.type = 'PURCHASE'
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
    WHERE p."companyId" = ${companyId}
      AND p."isActive" = true
      AND p."isService" = false
      AND p."stockQuantity" < 0
    GROUP BY p.id, p.slug, p.name, p.unit, p."stockQuantity"
    ORDER BY p."stockQuantity" ASC
  `)

  if (rows.length === 0) return null

  const hepsi: NegatifStokSatiri[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    ad: r.name,
    birim: r.unit,
    acik: Math.abs(sayi(r.stok)),
  }))

  return {
    urunSayisi: hepsi.length,
    toplamAcik: hepsi.reduce((t, s) => t + s.acik, 0),
    hicAlisiOlmayan: rows.filter((r) => Number(r.alis_kalemi) === 0).length,
    // Sorgu zaten en eksiden sıralı geliyor; ilk N tanesi en ağırları.
    ornekler: hepsi.slice(0, ORNEK_URUN_SAYISI),
  }
}
