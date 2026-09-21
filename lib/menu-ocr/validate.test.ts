import { describe, expect, it } from "vitest"
import { kalemDenetle, medyan, medyanTabanFiyat, menuyeBenziyorMu, oturumDenetle, TEKRAR_ESIGI } from "./validate"
import type { OturumBirlesimi } from "./tekillestir"
import type { MenuKalemBirlesik } from "./turler"

const kalem = (ad: string, fiyat: number | number[], ek: Partial<MenuKalemBirlesik> = {}): MenuKalemBirlesik => ({
  ad,
  anahtar: ad.toLowerCase(),
  aciklama: null,
  bolum: null,
  fiyatlar: (Array.isArray(fiyat) ? fiyat : [fiyat]).map((f, i) => ({ etiket: Array.isArray(fiyat) ? ["S", "L", "XL"][i] : null, fiyat: f })),
  sayfa: 1,
  kaynaklar: [{ scanId: "a", dosya: "1.jpg", sayfa: 1 }],
  cakisanFiyatlar: [],
  ...ek,
})

const birlesim = (kalemler: MenuKalemBirlesik[], ek: Partial<OturumBirlesimi> = {}): OturumBirlesimi => ({
  kalemler,
  bolumler: [],
  kdvNotlari: [],
  paraBirimleri: ["TRY"],
  fiyatsizSatir: 0,
  tekrar: 0,
  toplamSayfa: 1,
  enDusukGuven: 1,
  ...ek,
})

const durum = (d: ReturnType<typeof oturumDenetle>, anahtar: string) => d.find((x) => x.anahtar === anahtar)?.durum

describe("oturumDenetle", () => {
  it("fiyatlı kalem yoksa 'menüye benzemiyor' der ve kabul etmez", () => {
    const b = birlesim([])
    expect(menuyeBenziyorMu(b)).toBe(false)
    expect(durum(oturumDenetle(b), "kalem")).toBe("patladi")
  })

  it("temiz menü geçer; başlık satırları ve tekrar bilgi olarak yazılır", () => {
    const d = oturumDenetle(birlesim([kalem("Çay", 40), kalem("Kahve", 60)], { fiyatsizSatir: 3, tekrar: 1 }))
    expect(durum(d, "kalem")).toBe("gecti")
    expect(durum(d, "baslik")).toBe("olcelemedi")
    expect(durum(d, "tekrar")).toBe("gecti")
    expect(durum(d, "para")).toBe("gecti")
  })

  it("çakışan fiyat, yabancı para, KDV HARİÇ notu ve düşük güven patlar", () => {
    const d = oturumDenetle(
      birlesim([kalem("Çay", 40, { cakisanFiyatlar: [[{ etiket: null, fiyat: 45 }]] })], {
        tekrar: 1,
        paraBirimleri: ["USD"],
        kdvNotlari: ["Fiyatlarımıza KDV hariçtir"],
        enDusukGuven: 0.4,
      })
    )
    expect(durum(d, "tekrar")).toBe("patladi")
    expect(durum(d, "para")).toBe("patladi")
    expect(durum(d, "kdv")).toBe("patladi")
    expect(durum(d, "guven")).toBe("patladi")
  })

  it("aynı fiyat arka arkaya çok tekrar edince sütun kayması şüphesi düşer", () => {
    const ayni = Array.from({ length: TEKRAR_ESIGI }, (_, i) => kalem(`Ürün ${i}`, 50))
    expect(durum(oturumDenetle(birlesim(ayni)), "sutun")).toBe("olcelemedi")
    const farkli = Array.from({ length: TEKRAR_ESIGI }, (_, i) => kalem(`Ürün ${i}`, 50 + i))
    expect(durum(oturumDenetle(birlesim(farkli)), "sutun")).toBeUndefined()
  })
})

describe("kalemDenetle", () => {
  it("medyanın 20 katı / 20'de biri aykırı sayılır (₺5 kahve, ₺5.000 çay)", () => {
    expect(kalemDenetle(kalem("Çay", 5000), 100).find((d) => d.anahtar === "aykiri")?.durum).toBe("patladi")
    expect(kalemDenetle(kalem("Kahve", 4), 100).find((d) => d.anahtar === "aykiri")?.durum).toBe("patladi")
    expect(kalemDenetle(kalem("Latte", 120), 100).find((d) => d.anahtar === "aykiri")).toBeUndefined()
  })
  it("etiketsiz varyantta düzeltme ister", () => {
    const k = kalem("Latte", 90)
    k.fiyatlar = [{ etiket: null, fiyat: 90 }, { etiket: null, fiyat: 110 }]
    expect(kalemDenetle(k, 100).find((d) => d.anahtar === "etiket")?.durum).toBe("olcelemedi")
  })
  it("medyan taban fiyatlardan (çok fiyatlıda en düşük) hesaplanır", () => {
    expect(medyan([1, 5, 3])).toBe(3)
    expect(medyan([1, 2, 3, 4])).toBe(2.5)
    expect(medyan([])).toBeNull()
    expect(medyanTabanFiyat([kalem("A", [90, 200]), kalem("B", 50), kalem("C", 70)])).toBe(70)
  })
})
