// Aylık KDV mahsubu (kdv-mahsup.ts) ve muhasebe özeti adımları (ozet.ts).

import { describe, expect, it } from "vitest"
import { aylar, gecenAy, kdvMahsupPlani } from "./kdv-mahsup"
import { ozetAdimlari, type OzetSayilari } from "./ozet"

const dengeli = (s: Array<{ taraf: "B" | "A"; tutar: number }>) => {
  const b = s.filter((x) => x.taraf === "B").reduce((a, x) => a + x.tutar, 0)
  const a = s.filter((x) => x.taraf === "A").reduce((t, x) => t + x.tutar, 0)
  return Math.round(b * 100) === Math.round(a * 100)
}

describe("KDV mahsup planı", () => {
  it("hesaplanan fazlası ödenecek KDV'ye (360) geçer, devreden kullanılır", () => {
    const p = kdvMahsupPlani({
      ay: "2026-09",
      hesaplanan: [{ kod: "391", bakiye: -1000 }],
      indirilecek: [{ kod: "191", bakiye: 300 }],
      devreden: 200,
      odenecekHesabi: "360",
      devredenHesabi: "190",
    })
    expect(p.hatalar).toEqual([])
    expect(p.odenecek).toBe(500)
    expect(p.devredenSonraki).toBe(0)
    expect(p.satirlar).toEqual([
      { taraf: "B", kod: "391", tutar: 1000, aciklama: "Hesaplanan KDV kapatıldı" },
      { taraf: "A", kod: "191", tutar: 300, aciklama: "İndirilecek KDV kapatıldı" },
      { taraf: "A", kod: "190", tutar: 200, aciklama: "Önceki aydan devreden KDV kullanıldı" },
      { taraf: "A", kod: "360", tutar: 500, aciklama: "Ödenecek KDV" },
    ])
    expect(dengeli(p.satirlar)).toBe(true)
  })

  it("indirilecek fazlası devreden KDV olur (190 borç)", () => {
    const p = kdvMahsupPlani({
      ay: "2026-09",
      hesaplanan: [{ kod: "391", bakiye: -400 }],
      indirilecek: [{ kod: "191", bakiye: 1000 }],
      devreden: 0,
      odenecekHesabi: "360",
      devredenHesabi: "190",
    })
    expect(p.odenecek).toBe(0)
    expect(p.devredenSonraki).toBe(600)
    expect(p.satirlar.find((s) => s.kod === "190")).toEqual({ taraf: "B", kod: "190", tutar: 600, aciklama: "Sonraki aya devreden KDV" })
    expect(dengeli(p.satirlar)).toBe(true)
  })

  it("devredenin bir kısmı kullanılır: 190'dan yalnız kullanılan düşer", () => {
    const p = kdvMahsupPlani({
      ay: "2026-09",
      hesaplanan: [{ kod: "391", bakiye: -800 }],
      indirilecek: [{ kod: "191", bakiye: 500 }],
      devreden: 1000,
      odenecekHesabi: "360",
      devredenHesabi: "190",
    })
    expect(p.odenecek).toBe(0)
    expect(p.devredenSonraki).toBe(700)
    expect(p.satirlar.find((s) => s.kod === "190")).toMatchObject({ taraf: "A", tutar: 300 })
    expect(dengeli(p.satirlar)).toBe(true)
  })

  it("oran başına alt hesaplar yaprak yaprak kapatılır", () => {
    const p = kdvMahsupPlani({
      ay: "2026-09",
      hesaplanan: [
        { kod: "391.01", bakiye: -200 },
        { kod: "391.02", bakiye: -50 },
      ],
      indirilecek: [{ kod: "191.01", bakiye: 100 }],
      devreden: 0,
      odenecekHesabi: "360.01",
      devredenHesabi: "190",
    })
    expect(p.satirlar.map((s) => `${s.taraf} ${s.kod} ${s.tutar}`)).toEqual(["B 391.01 200", "B 391.02 50", "A 191.01 100", "A 360.01 150"])
  })

  it("360 alt hesaplı ve seçilmemişse hata — fiş yazılmaz", () => {
    const p = kdvMahsupPlani({
      ay: "2026-09",
      hesaplanan: [{ kod: "391", bakiye: -1000 }],
      indirilecek: [],
      devreden: 0,
      odenecekHesabi: null,
      devredenHesabi: "190",
    })
    expect(p.hatalar[0]).toMatch(/360/)
  })

  it("KDV bakiyesi yoksa mahsup edilecek bir şey yok", () => {
    const p = kdvMahsupPlani({ ay: "2026-09", hesaplanan: [], indirilecek: [], devreden: 0, odenecekHesabi: "360", devredenHesabi: "190" })
    expect(p.hatalar).toEqual(["Bu ay kapatılacak KDV bakiyesi yok."])
  })
})

describe("ay yardımcıları", () => {
  it("başlangıçtan geçen aya kadar, yıl atlayarak", () => {
    expect(aylar(new Date(Date.UTC(2025, 10, 15)), "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
    expect(aylar(new Date(Date.UTC(2026, 9, 1)), "2026-09")).toEqual([])
  })
  it("geçen ay İstanbul takvimiyle (1 Ekim 01:00 TSİ = 30 Eylül 22:00 UTC)", () => {
    expect(gecenAy(new Date("2026-09-30T22:00:00Z"))).toBe("2026-09")
    expect(gecenAy(new Date("2026-01-15T12:00:00Z"))).toBe("2025-12")
  })
})

const BOS: OzetSayilari = {
  emin: 0,
  gozden: 0,
  degisti: 0,
  onayli: 10,
  hesapsizSatir: 0,
  enEskiTaslak: null,
  acilis: { durum: "POSTED", emin: true, degisti: false },
  baslangicBakiyesiVar: true,
  kapanmamisYillar: [],
  kdvMahsupBekleyen: [],
}

describe("muhasebe özeti adımları", () => {
  it("her şey tamamsa yapılacak adım yok", () => {
    expect(ozetAdimlari(BOS).filter((a) => a.durum === "yapilacak" || a.durum === "uyari")).toEqual([])
  })
  it("sıra: açılış → hesap seçimi → onay → belge değişti → KDV → kapanış", () => {
    const a = ozetAdimlari({
      ...BOS,
      emin: 4,
      gozden: 3,
      hesapsizSatir: 5,
      degisti: 1,
      acilis: { durum: "DRAFT", emin: false, degisti: false },
      kdvMahsupBekleyen: ["2026-08", "2026-09"],
      kapanmamisYillar: [2025],
    })
    expect(a.map((x) => x.anahtar)).toEqual(["acilis", "gozden", "emin", "degisti", "kdv", "kapanis-2025"])
    const smmli = ozetAdimlari({ ...BOS, smmBekleyen: ["2026-09"], kdvMahsupBekleyen: ["2026-09"] })
    expect(smmli.map((x) => x.anahtar).slice(-2)).toEqual(["smm", "kdv"])
    expect(a.find((x) => x.anahtar === "gozden")!.baslik).toBe("3 fiş hesap seçimi bekliyor")
    expect(a.find((x) => x.anahtar === "kdv")!.baslik).toBe("2 ayın KDV mahsubu bekliyor")
  })
  it("açılış fişi yoksa ve başlangıçta bakiye yoksa bilgi olarak söylenir", () => {
    const a = ozetAdimlari({ ...BOS, acilis: null, baslangicBakiyesiVar: false })
    expect(a[0]).toMatchObject({ anahtar: "acilis", durum: "bilgi" })
  })
})

describe("satılan malın maliyeti planı", async () => {
  const { smmPlani, ayBitisAni } = await import("./stok-maliyeti")
  it("153 bakiyesi − stok değeri = maliyet: B 621 · A 153", () => {
    const p = smmPlani({ ay: "2026-09", stok153: [{ kod: "153", bakiye: 10000 }], stokDegeri: 6500, maliyetHesabi: "621", stokYapragi: "153" })
    expect(p.maliyet).toBe(3500)
    expect(p.satirlar.map((s) => `${s.taraf} ${s.kod} ${s.tutar}`)).toEqual(["B 621 3500", "A 153 3500"])
    expect(p.uyarilar).toEqual([])
  })
  it("stok değeri defterden fazla → eksi maliyet, uyarıyla (iade, sayım fazlası)", () => {
    const p = smmPlani({ ay: "2026-09", stok153: [{ kod: "153", bakiye: 1000 }], stokDegeri: 1200, maliyetHesabi: "621", stokYapragi: "153" })
    expect(p.maliyet).toBe(-200)
    expect(p.satirlar.map((s) => `${s.taraf} ${s.kod}`)).toEqual(["A 621", "B 153"])
    expect(p.uyarilar.length).toBe(1)
  })
  it("153 alt hesaplı ve seçilmemişse hata", () => {
    const p = smmPlani({ ay: "2026-09", stok153: [{ kod: "153.01", bakiye: 500 }], stokDegeri: 0, maliyetHesabi: "621", stokYapragi: null })
    expect(p.hatalar[0]).toMatch(/153/)
  })
  it("ay sonu sınırı İstanbul gece yarısı", () => {
    expect(ayBitisAni("2026-09").toISOString()).toBe("2026-09-30T21:00:00.000Z")
    expect(ayBitisAni("2026-12").toISOString()).toBe("2026-12-31T21:00:00.000Z")
  })
})
