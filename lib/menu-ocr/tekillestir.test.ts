import { describe, expect, it } from "vitest"
import { fiyatKumesiEsitMi, oturumBirlestir } from "./tekillestir"
import type { MenuOkuma } from "./turler"

const sayfa = (kalemler: Array<Partial<MenuOkuma["kalemler"][number]> & { ad: string; fiyat: number | number[] }>, ek: Partial<MenuOkuma> = {}): MenuOkuma => ({
  bolumler: [],
  kalemler: kalemler.map((k) => ({
    ad: k.ad,
    aciklama: k.aciklama ?? null,
    bolum: k.bolum ?? null,
    fiyatlar: (Array.isArray(k.fiyat) ? k.fiyat : [k.fiyat]).map((f) => ({ etiket: null, fiyat: f })),
    sayfa: k.sayfa ?? 1,
  })),
  kdvNotu: null,
  paraBirimi: "TRY",
  guven: { kalemler: 1, fiyatlar: 1, bolumler: 1 },
  fiyatsizSatir: 0,
  ...ek,
})

describe("oturumBirlestir", () => {
  it("aynı ad iki sayfada geçerse teke iner (Türkçe duyarsız)", () => {
    const b = oturumBirlestir([
      { scanId: "a", dosya: "menu-1.jpg", sayfalar: [sayfa([{ ad: "TÜRK KAHVESİ", fiyat: 60 }, { ad: "Latte", fiyat: 90 }])] },
      { scanId: "b", dosya: "menu-2.jpg", sayfalar: [sayfa([{ ad: "türk kahvesi", fiyat: 60 }])] },
    ])
    expect(b.kalemler).toHaveLength(2)
    expect(b.tekrar).toBe(1)
    const tk = b.kalemler.find((k) => k.anahtar === "turk kahvesi")!
    expect(tk.kaynaklar).toEqual([
      { scanId: "a", dosya: "menu-1.jpg", sayfa: 1 },
      { scanId: "b", dosya: "menu-2.jpg", sayfa: 1 },
    ])
    expect(tk.cakisanFiyatlar).toEqual([])
  })

  it("aynı ad farklı fiyatla geçerse ilk görülen kalır, çakışma yazılır", () => {
    const b = oturumBirlestir([
      { scanId: "a", dosya: "1.jpg", sayfalar: [sayfa([{ ad: "Çay", fiyat: 40 }]), sayfa([{ ad: "Çay", fiyat: 45, sayfa: 2 }])] },
    ])
    expect(b.kalemler).toHaveLength(1)
    expect(b.kalemler[0].fiyatlar[0].fiyat).toBe(40)
    expect(b.kalemler[0].cakisanFiyatlar).toEqual([[{ etiket: null, fiyat: 45 }]])
  })

  // "SICAK İÇECEKLER" 1. sayfada başlar, 2. sayfaya taşar: model 2. sayfayı tek
  // başına gördüğü için bölümü bilemez; devir burada yapılır.
  it("başlıksız başlayan sayfa önceki sayfanın bölümünü devralır", () => {
    const b = oturumBirlestir([
      {
        scanId: "a",
        dosya: "1.pdf",
        sayfalar: [
          sayfa([{ ad: "Latte", fiyat: 90, bolum: "Sıcak İçecekler" }, { ad: "Mocha", fiyat: 100, bolum: "Sıcak İçecekler" }], { bolumler: ["Sıcak İçecekler"] }),
          sayfa([{ ad: "Sahlep", fiyat: 80, sayfa: 2 }, { ad: "Limonata", fiyat: 70, bolum: "Soğuk İçecekler", sayfa: 2 }, { ad: "Ayran", fiyat: 30, sayfa: 2 }]),
        ],
      },
    ])
    const bolum = (ad: string) => b.kalemler.find((k) => k.ad === ad)!.bolum
    expect(bolum("Sahlep")).toBe("Sıcak İçecekler")
    expect(bolum("Limonata")).toBe("Soğuk İçecekler")
    expect(bolum("Ayran")).toBe("Soğuk İçecekler")
    expect(b.bolumler).toEqual(["Sıcak İçecekler", "Soğuk İçecekler"])
  })

  it("oturum notlarını toplar: KDV notu, para birimi, fiyatsız satır, en düşük güven", () => {
    const b = oturumBirlestir([
      { scanId: "a", dosya: "1.jpg", sayfalar: [sayfa([{ ad: "Çay", fiyat: 40 }], { kdvNotu: "KDV dahildir", fiyatsizSatir: 2, guven: { kalemler: 0.9, fiyatlar: 0.5, bolumler: 1 } })] },
      { scanId: "b", dosya: "2.jpg", sayfalar: [sayfa([{ ad: "Kahve", fiyat: 3 }], { paraBirimi: "USD", fiyatsizSatir: 1 })] },
    ])
    expect(b.kdvNotlari).toEqual(["KDV dahildir"])
    expect(b.paraBirimleri).toEqual(["TRY", "USD"])
    expect(b.fiyatsizSatir).toBe(3)
    expect(b.enDusukGuven).toBe(0.5)
    expect(b.toplamSayfa).toBe(2)
  })
})

describe("fiyatKumesiEsitMi", () => {
  it("etiketten bağımsız, sıradan bağımsız karşılaştırır", () => {
    expect(fiyatKumesiEsitMi([{ etiket: "S", fiyat: 90 }, { etiket: "L", fiyat: 110 }], [{ etiket: null, fiyat: 110 }, { etiket: null, fiyat: 90 }])).toBe(true)
    expect(fiyatKumesiEsitMi([{ etiket: null, fiyat: 90 }], [{ etiket: null, fiyat: 90 }, { etiket: null, fiyat: 110 }])).toBe(false)
  })
})
