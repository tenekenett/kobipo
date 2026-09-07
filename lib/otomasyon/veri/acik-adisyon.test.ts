// K-OPR-06'nın İKİ AYRIMI: boş adisyon ve tutarın kaynağı.
//
// Boş adisyon (hiç kalem girilmemiş masa) "kayıp ciro" DEĞİLDİR; kart onu ayrı
// sayar ve ayrı cümleyle söyler. Ölçümde açık 5 adisyonun 2'si böyleydi —
// ayrım kaldırılsa kart "₺0'lık satış rapora girmedi" demeye başlar ve bunu
// hiçbir sorgu hatası göstermez.
//
// Tutar `ticketTotals` ile hesaplanıyor (adisyon ekranının kullandığı fonksiyon):
// ikram/zayi kalemleri ve hesap iskontosu tam orada ayrışıyor.

import { describe, expect, it } from "vitest"
import { acikAdisyonSec, type HamAdisyon } from "./acik-adisyon"

const BUGUN = new Date("2026-09-07T09:00:00Z")
const gunOnce = (n: number) => new Date(BUGUN.getTime() - n * 86_400_000)

const kalem = (quantity: number, unitPrice: number, status: string | null = "NORMAL") => ({
  quantity,
  unitPrice,
  vatRate: 10,
  status,
})

const adisyon = (over: Partial<HamAdisyon> & { id: string; yas: number }): HamAdisyon => ({
  code: `ADS-${over.id}`,
  openedAt: gunOnce(over.yas),
  discountType: null,
  discountValue: null,
  table: { name: `M${over.id}` },
  items: [kalem(1, 100)],
  ...over,
})

describe("K-OPR-06 açık adisyon özeti", () => {
  it("boş adisyon AYRI sayılır ve toplama ₺0 katar", () => {
    const o = acikAdisyonSec(
      [adisyon({ id: "bos", yas: 19, items: [] }), adisyon({ id: "dolu", yas: 31 })],
      BUGUN
    )
    expect(o?.adet).toBe(2)
    expect(o?.bosAdet).toBe(1)
    // 1 × 100 + %10 KDV = 110
    expect(o?.toplamTutar).toBe(110)
  })

  it("tutar ticketTotals'tan gelir: ikram/zayi kalemi hesaba GİRMEZ", () => {
    const o = acikAdisyonSec(
      [
        adisyon({
          id: "a",
          yas: 5,
          items: [kalem(2, 100), kalem(1, 500, "COMP"), kalem(1, 300, "WASTE")],
        }),
      ],
      BUGUN
    )
    // Yalnız NORMAL kalem: 2 × 100 = 200 + %10 = 220
    expect(o?.toplamTutar).toBe(220)
    // Kalem SAYISI ise hepsini kapsar — masa boş değildir.
    expect(o?.ornekler[0].kalemAdet).toBe(3)
    expect(o?.bosAdet).toBe(0)
  })

  it("hesap iskontosu düşülür — kartın tutarı masanın üstündeki tutardır", () => {
    const o = acikAdisyonSec(
      [
        adisyon({
          id: "a",
          yas: 5,
          items: [kalem(1, 1_000)],
          discountType: "PERCENT",
          discountValue: 10,
        }),
      ],
      BUGUN
    )
    // 1.000 + %10 KDV = 1.100; %10 hesap iskontosu → 990
    expect(o?.toplamTutar).toBe(990)
  })

  it("parası büyük olan öne geçer, eşitlikte en uzun bekleyen", () => {
    const o = acikAdisyonSec(
      [
        adisyon({ id: "kucuk", yas: 40, items: [kalem(1, 10)] }),
        adisyon({ id: "buyuk", yas: 2, items: [kalem(1, 5_000)] }),
        adisyon({ id: "esit1", yas: 3, items: [kalem(1, 10)] }),
      ],
      BUGUN
    )
    expect(o?.ornekler.map((a) => a.id)).toEqual(["buyuk", "kucuk", "esit1"])
    expect(o?.enUzunGun).toBe(40)
  })

  it("kayıt yoksa kart üretilmez", () => {
    expect(acikAdisyonSec([], BUGUN)).toBeNull()
  })
})
