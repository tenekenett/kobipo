/**
 * K-OPR-06 · "Masanın hesabı N gündür açık — o satış hiçbir yere işlenmedi."
 *
 * ── Neden bu bir kart, "açık masa" bilgisi değil ────────────────────────────
 * Kafede masa açık olması normaldir; DEVREDEN adisyon normal değildir. Kapanış
 * ne kadar gecikirse rakamlar o kadar yanlış: adisyon kapanana kadar fiş
 * KESİLMEZ (`lib/restoran/tickets.ts` başlığı: fiş yolu kapanışta çalışır),
 * yani o masadan çıkan ürünler STOKTAN DÜŞMEZ ve tutar CİROYA GİRMEZ. Kartın
 * söylediği sonuç budur — "masa açık" değil, "bugünkü cironuz ve stoğunuz bu
 * masa kadar eksik".
 *
 * ── Ölçüm (2026-09-07, canlı) ──────────────────────────────────────────────
 * Açık 5 adisyonun tamamı devretmiş: 19–32 gün. Üçünde kalem var
 * (₺2.692 · ₺2.692 · ₺308), ikisi boş açılmış masa. Adisyon durumları:
 * 20 CLOSED, 5 OPEN, 4 CANCELLED.
 *
 * BOŞ ADİSYON DA SAYILIR ama ayrı söylenir: kalemi olmayan masa ciroyu
 * bozmuyor, sadece masa planını kilitli tutuyor. İkisini tek cümlede toplamak,
 * "₺0'lık satışın rapora girmediğini" ima etmek olurdu.
 *
 * ── Tutar tek kaynaktan ────────────────────────────────────────────────────
 * Toplam `ticketTotals` ile hesaplanır — adisyon ekranının ve kapanışın kullandığı
 * fonksiyonun ta kendisi. İkinci bir çarpım yazmak, kartın söylediği tutarın
 * masanın üstündeki tutardan farklı çıkması demekti (ikram/zayi kalemleri ve
 * hesap iskontosu tam da burada ayrışır).
 */

import { prisma } from "@/lib/db/prisma"
import { ticketDiscountOf, ticketTotals } from "@/lib/restoran/ticket-constants"
import { bugunBasi } from "@/lib/asistan/veri/temel"

/** Kartta adı geçecek adisyon sayısı. */
export const ORNEK_ADISYON_SAYISI = 3

/** Bu günden uzun süre açık kalan adisyon kartı YÜKSEK yapar. */
export const YUKSEK_ESIK_GUN = 3

/** Sorgudan gelen ham adisyon — saf özetin girdisi. */
export type HamAdisyon = {
  id: string
  code: string
  openedAt: Date
  discountType: string | null
  discountValue: unknown
  table: { name: string } | null
  items: Array<{ quantity: unknown; unitPrice: unknown; vatRate: unknown; status?: string | null }>
}

export type AcikAdisyon = {
  id: string
  kod: string
  masa: string | null
  /** Bugüne kadar kaç gündür açık. */
  gun: number
  /** Ödenecek tutar (ikram/zayi hariç, hesap iskontosu düşülmüş). */
  tutar: number
  kalemAdet: number
}

export type AcikAdisyonOzeti = {
  adet: number
  enUzunGun: number
  /** Kalemi olan adisyonların toplamı — ciroya girmemiş tutar. */
  toplamTutar: number
  /** Hiç kalemi olmayan (boş açılmış) adisyon sayısı. */
  bosAdet: number
  ornekler: AcikAdisyon[]
}

/**
 * Bugünden ÖNCE açılmış ve hâlâ açık duran adisyonlar.
 *
 * Sınır günün başı: bu sabah açılan masa devretmiş sayılmaz, akşam açılıp
 * gece yarısını geçen masa sayılır. Gün sınırı kod tabanının her yerindeki
 * `bugunBasi` ile çizilir (İstanbul takvim günü); ikinci bir tarih ekseni,
 * kartın saydığı günle gün sonu raporunun saydığı günü ayırırdı.
 */
export async function acikAdisyonOzeti(companyId: string): Promise<AcikAdisyonOzeti | null> {
  const sinir = bugunBasi()

  const kayitlar = await prisma.restaurantTicket.findMany({
    where: { companyId, status: "OPEN", openedAt: { lt: sinir } },
    select: {
      id: true,
      code: true,
      openedAt: true,
      discountType: true,
      discountValue: true,
      table: { select: { name: true } },
      items: { select: { quantity: true, unitPrice: true, vatRate: true, status: true } },
    },
    orderBy: { openedAt: "asc" },
  })

  if (kayitlar.length === 0) return null
  // Gün sayısı BUGÜNE göre; `sinir` yalnız sorgunun eşiğiydi.
  return acikAdisyonSec(kayitlar)
}

/**
 * ÖZET — saf fonksiyon, veritabanı bilmez.
 *
 * İki karar burada: BOŞ adisyonun ayrı sayılması (kartın "₺0'lık satış kayıp"
 * dememesi için) ve tutarın `ticketTotals` ile hesaplanması (ikram/zayi ve hesap
 * iskontosu tam orada ayrışıyor). İkisi de sorgunun dışında.
 */
export function acikAdisyonSec(
  kayitlar: HamAdisyon[],
  simdiTarih: Date = new Date()
): AcikAdisyonOzeti | null {
  if (kayitlar.length === 0) return null

  const gun = 86_400_000
  const simdi = simdiTarih.getTime()

  const satirlar: AcikAdisyon[] = kayitlar.map((t) => {
    const toplam = ticketTotals(t.items, ticketDiscountOf(t))
    return {
      id: t.id,
      kod: t.code,
      masa: t.table?.name ?? null,
      gun: Math.floor((simdi - t.openedAt.getTime()) / gun),
      tutar: toplam.total,
      kalemAdet: t.items.length,
    }
  })

  // Parası olan adisyon önce: kartta adı geçecek üç satır, ciroyu en çok
  // eksilten üç masa olmalı. Eşitlikte en uzun bekleyen öne geçer.
  const sirali = [...satirlar].sort((a, b) => b.tutar - a.tutar || b.gun - a.gun)

  return {
    adet: satirlar.length,
    enUzunGun: Math.max(...satirlar.map((s) => s.gun)),
    toplamTutar: satirlar.reduce((t, s) => t + s.tutar, 0),
    bosAdet: satirlar.filter((s) => s.kalemAdet === 0).length,
    ornekler: sirali.slice(0, ORNEK_ADISYON_SAYISI),
  }
}
