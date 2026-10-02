// "Nakit kaç gün yeter" aritmetiği (nakit-yeterlilik-hesap.ts).

import { describe, expect, it } from "vitest"
import { nakitYeterlilik, type NakitYeterlilikGirdi } from "./nakit-yeterlilik-hesap"

const girdi = (over: Partial<NakitYeterlilikGirdi>): NakitYeterlilikGirdi => ({
  nakit: 300_000,
  krediKarti: 0,
  cikis: 270_000,
  giris: 240_000,
  cikisAdedi: 40,
  gozlemGun: 90,
  ...over,
})

describe("nakitYeterlilik", () => {
  it("nakit ÷ günlük ortalama çıkış; girişler hesaba girmez", () => {
    // 270.000 / 90 = 3.000 TL/gün → 300.000 / 3.000 = 100 gün.
    const r = nakitYeterlilik(girdi({}))
    expect(r.durum).toBe("hesaplandi")
    expect(r.gun).toBe(100)
    expect(r.aylikCikis).toBe(90_000)
    expect(r.aylikGiris).toBe(80_000)
    // Girişler iki katına çıksa da gün değişmez: soru "hiç tahsilat gelmezse".
    expect(nakitYeterlilik(girdi({ giris: 480_000 })).gun).toBe(100)
  })

  it("gün aşağı yuvarlanır (yetmeyen günü yetmiş saymayız)", () => {
    expect(nakitYeterlilik(girdi({ nakit: 299_999 })).gun).toBe(99)
  })

  it("geçmiş kısaysa ortalama gözlenen güne bölünür", () => {
    // 45 günde 90.000 çıkış = 2.000/gün → 60.000 / 2.000 = 30 gün.
    const r = nakitYeterlilik(girdi({ nakit: 60_000, cikis: 90_000, gozlemGun: 45 }))
    expect(r.gun).toBe(30)
    expect(r.aylikCikis).toBe(60_000)
  })

  it("1 yılı aşan sonuç işaretlenir", () => {
    const r = nakitYeterlilik(girdi({ nakit: 2_000_000, cikis: 9_000 }))
    expect(r.durum).toBe("hesaplandi")
    expect(r.ustSinirdaAsti).toBe(true)
  })

  it("nakit sıfır ya da eksiyse gün yazılmaz", () => {
    for (const nakit of [0, -1_467_043]) {
      const r = nakitYeterlilik(girdi({ nakit }))
      expect(r.durum).toBe("nakit-yok")
      expect(r.gun).toBeNull()
    }
  })

  it("30 günden kısa geçmişte gün yazılmaz", () => {
    const r = nakitYeterlilik(girdi({ gozlemGun: 20 }))
    expect(r.durum).toBe("gecmis-kisa")
    expect(r.gun).toBeNull()
  })

  it("çıkış kaydı azsa gün yazılmaz (canlı örnek: 3,2 milyon nakit, 90 günde tek 580 TL)", () => {
    const r = nakitYeterlilik(girdi({ nakit: 3_204_593, cikis: 580, cikisAdedi: 1 }))
    expect(r.durum).toBe("cikis-az")
    expect(r.gun).toBeNull()
    expect(nakitYeterlilik(girdi({ cikis: 0, cikisAdedi: 0 })).durum).toBe("cikis-az")
  })
})
