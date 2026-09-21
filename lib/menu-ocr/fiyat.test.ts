import { describe, expect, it } from "vitest"
import { brutFiyat, grupAdiTuret, kdvOnerisi, kdvOraniOku, netFiyat, secenekGrubuTuret, tabanBrut } from "./fiyat"

describe("netFiyat / brutFiyat", () => {
  it("menüdeki 120 ₺, %10 KDV'de 109,090909 net olur ve geri 120'ye döner", () => {
    expect(netFiyat(120, 10)).toBe(109.090909)
    expect(brutFiyat(109.090909, 10)).toBe(120)
  })
  it("%0'da fiyat değişmez", () => {
    expect(netFiyat(120, 0)).toBe(120)
    expect(brutFiyat(120, 0)).toBe(120)
  })
  it("%20 birayı %10 ile net'lemek fiyatı bozar — oran ürünün kendisinden gelmeli (karar B)", () => {
    // 150 ₺'lik bira: doğru net 125, yanlış oranla 136,36 → ekranda 163,64 ₺ görünür
    expect(netFiyat(150, 20)).toBe(125)
    expect(brutFiyat(netFiyat(150, 10), 20)).toBe(163.64)
  })
})

describe("kdvOnerisi", () => {
  it("alkollü bölüm/ürün %20, gerisi oturum oranı", () => {
    expect(kdvOnerisi("ALKOLLÜ İÇECEKLER", "Efes", 10)).toBe(20)
    expect(kdvOnerisi("İçecekler", "Bira 50cl", 10)).toBe(20)
    expect(kdvOnerisi("Şaraplar", "Kav Kalecik", 10)).toBe(20)
    expect(kdvOnerisi("Sıcak İçecekler", "Latte", 10)).toBe(10)
    expect(kdvOnerisi(null, "Cinnamon Roll", 10)).toBe(10) // "cin " sözlüğü kelime sınırlı
    expect(kdvOnerisi(null, "Romantik Tatlı", 1)).toBe(1)
  })
})

describe("grupAdiTuret", () => {
  it("boy sözlüğü → Boy, servis sözlüğü → Servis, tanınmayan → Seçenek", () => {
    expect(grupAdiTuret(["Küçük", "Büyük"])).toEqual({ ad: "Boy", taninmadi: false })
    expect(grupAdiTuret(["S", "M", "L"])).toEqual({ ad: "Boy", taninmadi: false })
    expect(grupAdiTuret(["33cl", "50 cl"])).toEqual({ ad: "Boy", taninmadi: false })
    expect(grupAdiTuret(["Sıcak", "Soğuk"])).toEqual({ ad: "Servis", taninmadi: false })
    expect(grupAdiTuret(["Tavuklu", "Etli"])).toEqual({ ad: "Seçenek", taninmadi: true })
    expect(grupAdiTuret([null, null])).toEqual({ ad: "Seçenek", taninmadi: true })
  })
})

describe("secenekGrubuTuret", () => {
  it("Latte 90/110/130 → tek ürün, Boy grubu, KDV DAHİL farklar (karar A)", () => {
    const g = secenekGrubuTuret([{ etiket: "Küçük", fiyat: 90 }, { etiket: "Orta", fiyat: 110 }, { etiket: "Büyük", fiyat: 130 }])!
    expect(g.ad).toBe("Boy")
    expect(g.etiketTaninmadi).toBe(false)
    expect(g.secenekler).toEqual([
      { ad: "Küçük", priceDelta: 0, isDefault: true },
      { ad: "Orta", priceDelta: 20, isDefault: false },
      { ad: "Büyük", priceDelta: 40, isDefault: false },
    ])
  })
  it("sırayı fiyata göre kurar; taban en düşük", () => {
    const g = secenekGrubuTuret([{ etiket: "Büyük", fiyat: 130 }, { etiket: "Küçük", fiyat: 90 }])!
    expect(g.secenekler.map((s) => s.ad)).toEqual(["Küçük", "Büyük"])
    expect(tabanBrut([{ etiket: "Büyük", fiyat: 130 }, { etiket: "Küçük", fiyat: 90 }])).toBe(90)
  })
  it("etiketsiz fiyatta şık adı UYDURULMAZ, fiyattan alınır ve düzeltme istenir", () => {
    const g = secenekGrubuTuret([{ etiket: null, fiyat: 90 }, { etiket: null, fiyat: 110 }])!
    expect(g.ad).toBe("Seçenek")
    expect(g.etiketTaninmadi).toBe(true)
    expect(g.secenekler.map((s) => s.ad)).toEqual(["90 ₺", "110 ₺"])
  })
  it("tek fiyatta grup yok", () => {
    expect(secenekGrubuTuret([{ etiket: null, fiyat: 60 }])).toBeNull()
  })
})

describe("kdvOraniOku", () => {
  // Uçtan uca testte yakalandı: `Number(null)` 0 döner, 0 geçerli oran → param
  // yokken tüm yeni ürünler %0 ile net=brüt yazılıyordu.
  it("eksik/boş param null döner, 0 açıkça verilirse 0", () => {
    expect(kdvOraniOku(null)).toBeNull()
    expect(kdvOraniOku(undefined)).toBeNull()
    expect(kdvOraniOku("")).toBeNull()
    expect(kdvOraniOku("0")).toBe(0)
    expect(kdvOraniOku("10")).toBe(10)
    expect(kdvOraniOku(20)).toBe(20)
    expect(kdvOraniOku("abc")).toBeNull()
    expect(kdvOraniOku("120")).toBeNull()
  })
})
