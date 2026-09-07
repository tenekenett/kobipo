// K-MUS-06'nın EŞİĞİ — kartın tek gerçek kararı.
//
// "Kaç gün sessizlik kayıptır" sorusunun cevabı firmanın kendi ritminden
// türetiliyor ve üç ayarı da canlı ölçüm belirledi (%75'lik dilim, 30 günlük
// taban, kalibrasyonsuz 90 gün). Ölçüm bir kerelikti: ayarlardan biri
// değişirse hiçbir sorgu hata vermez, kart sessizce yanlış müşteriyi "kayıp"
// ilan eder. Medyana dönülmesi, ölçümde 10 gün önce alışveriş yapmış 28 kişiyi
// kayıp saymak demekti — birinci test tam olarak onu tutuyor.

import { describe, expect, it } from "vitest"
import {
  donmeyenSec,
  EN_AZ_TEKRAR_EDEN,
  KALIBRASYONSUZ_GUN,
  TABAN_GUN,
  type Satir,
} from "./donmeyen-musteri"

const BUGUN = new Date("2026-09-07T09:00:00Z")
const gunOnce = (n: number) => new Date(BUGUN.getTime() - n * 86_400_000)

/** Tek alım yapmış müşteri satırı. */
const tek = (over: Partial<Satir> & { id: string; sonGun: number }): Satir => ({
  slug: null,
  ad: `Müşteri ${over.id}`,
  yetkili: null,
  telefon: null,
  adet: BigInt(1),
  ilk: gunOnce(over.sonGun),
  ikinci: null,
  son: gunOnce(over.sonGun),
  ciro: 10_000,
  ...over,
})

/** Geri dönmüş müşteri — yalnız ritmi beslemek için. */
const donen = (id: string, aralikGun: number): Satir => ({
  id,
  slug: null,
  ad: `Dönen ${id}`,
  yetkili: null,
  telefon: null,
  adet: BigInt(2),
  ilk: gunOnce(300),
  ikinci: gunOnce(300 - aralikGun),
  son: gunOnce(300 - aralikGun),
  ciro: 5_000,
})

/** `n` adet dönen müşteri, verilen aralıklarla. */
const ritim = (araliklar: number[]) => araliklar.map((g, i) => donen(`d${i}`, g))

describe("K-MUS-06 eşiği", () => {
  it("eşik ritmin %75'lik diliminin İKİ KATI olur", () => {
    // Aralıklar: 1,2,3,4,40 → p75 = 4 → eşik max(8, 30) = 30 (taban devrede).
    // Medyan kullanılsaydı 2×2 = 4 gün olurdu; 20 günlük sessizlik "kayıp" sayılırdı.
    const sonuc = donmeyenSec(
      [...ritim([1, 2, 3, 4, 40]), tek({ id: "x", sonGun: 20 })],
      BUGUN
    )
    expect(sonuc).toBeNull()
  })

  it("%75'lik dilim büyükse eşik tabandan yukarı çıkar", () => {
    // Aralıklar: 10,20,30,40,50 → p75 = 40 → eşik 80.
    const araliklar = ritim([10, 20, 30, 40, 50])
    expect(donmeyenSec([...araliklar, tek({ id: "x", sonGun: 70 })], BUGUN)).toBeNull()
    const gecen = donmeyenSec([...araliklar, tek({ id: "x", sonGun: 90 })], BUGUN)
    expect(gecen?.esikGun).toBe(80)
    expect(gecen?.kaynak).toBe("ritim")
    expect(gecen?.ritimGun).toBe(40)
  })

  it("TABAN 30 günün altına inilmez — ritmi sıkı firmada haksız kart çıkardı", () => {
    // Aralıkların tamamı 1 gün → p75 = 1 → 2×1 = 2, taban 30'a yükseltir.
    const sonuc = donmeyenSec(
      [...ritim([1, 1, 1, 1, 1]), tek({ id: "x", sonGun: 20 }), tek({ id: "y", sonGun: 40 })],
      BUGUN
    )
    expect(sonuc?.esikGun).toBe(TABAN_GUN)
    expect(sonuc?.ornekler.map((m) => m.id)).toEqual(["y"])
  })

  it("ritim ölçmeye yetmeyen firmada SABİT pencereye düşer", () => {
    const azDonen = ritim([5, 5, 5, 5]).slice(0, EN_AZ_TEKRAR_EDEN - 1)
    const sonuc = donmeyenSec(
      [...azDonen, tek({ id: "x", sonGun: 100 }), tek({ id: "y", sonGun: 60 })],
      BUGUN
    )
    expect(sonuc?.kaynak).toBe("sabit")
    expect(sonuc?.esikGun).toBe(KALIBRASYONSUZ_GUN)
    // 60 günlük sessizlik sabit pencerede kayıp değildir.
    expect(sonuc?.ornekler.map((m) => m.id)).toEqual(["x"])
  })

  it("₺0 cirolu tek kayıt ELENİR — kayıp müşteri değil, deneme kaydıdır", () => {
    const sonuc = donmeyenSec([tek({ id: "bos", sonGun: 200, ciro: 0 })], BUGUN)
    expect(sonuc).toBeNull()
  })

  it("birden çok alışı olan müşteri hiç aday değildir", () => {
    const sonuc = donmeyenSec([{ ...tek({ id: "c", sonGun: 200 }), adet: BigInt(2) }], BUGUN)
    expect(sonuc).toBeNull()
  })

  it("en çok ciro yapan öne geçer; toplam ciro hepsini kapsar", () => {
    const sonuc = donmeyenSec(
      [
        tek({ id: "kucuk", sonGun: 200, ciro: 1_000 }),
        tek({ id: "buyuk", sonGun: 120, ciro: 90_000 }),
        tek({ id: "orta", sonGun: 150, ciro: 9_000 }),
      ],
      BUGUN
    )
    expect(sonuc?.ornekler.map((m) => m.id)).toEqual(["buyuk", "orta", "kucuk"])
    expect(sonuc?.toplamCiro).toBe(100_000)
    expect(sonuc?.adet).toBe(3)
  })
})
