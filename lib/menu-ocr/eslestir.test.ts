import { describe, expect, it } from "vitest"
import { farkListesiKur, kovaSay } from "./eslestir"
import { trFold } from "@/lib/text/tr-fold"
import type { MenuKalemBirlesik, MevcutUrun } from "./turler"

const kalem = (ad: string, fiyatlar: Array<[string | null, number]>, bolum: string | null = null): MenuKalemBirlesik => ({
  ad,
  anahtar: trFold(ad),
  aciklama: null,
  bolum,
  fiyatlar: fiyatlar.map(([etiket, fiyat]) => ({ etiket, fiyat })),
  sayfa: 1,
  kaynaklar: [{ scanId: "a", dosya: "1.jpg", sayfa: 1 }],
  cakisanFiyatlar: [],
})

const urun = (id: string, name: string, net: number | null, ek: Partial<MevcutUrun> = {}): MevcutUrun => ({
  id,
  name,
  slug: null,
  category: null,
  vatRate: 10,
  salePrice: net,
  isSellable: true,
  isService: false,
  isActive: true,
  receteVar: false,
  secenekGrubu: 0,
  ...ek,
})

describe("farkListesiKur", () => {
  it("üç kovaya ayırır: yeni / fiyat değişmiş / aynı — eşleşme Türkçe duyarsız", () => {
    const fark = farkListesiKur(
      [kalem("TÜRK KAHVESİ", [[null, 66]]), kalem("Latte", [[null, 110]]), kalem("Sahlep", [[null, 80]], "Sıcak İçecekler")],
      [urun("u1", "Türk Kahvesi", 60), urun("u2", "latte", 90.909091)],
      { oturumKdv: 10, tamMenu: false }
    )
    expect(kovaSay(fark)).toEqual({ YENI: 1, FIYAT_DEGISMIS: 1, AYNI: 1, MENUDE_YOK: 0 })
    const tk = fark.find((f) => f.anahtar === "turk kahvesi")!
    expect(tk.kova).toBe("AYNI") // 60 net × 1.10 = 66 ₺
    const latte = fark.find((f) => f.anahtar === "latte")!
    expect(latte.kova).toBe("FIYAT_DEGISMIS")
    if (latte.kova === "FIYAT_DEGISMIS") {
      expect(latte.eskiBrut).toBe(100)
      expect(latte.yeniBrut).toBe(110)
      expect(latte.yeniNet).toBe(100)
    }
    const sahlep = fark.find((f) => f.anahtar === "sahlep")!
    expect(sahlep.kova).toBe("YENI")
    if (sahlep.kova === "YENI") {
      expect(sahlep.oneri).toMatchObject({ kdvOrani: 10, brut: 80, net: 72.727273, kategori: "Sıcak İçecekler", secenekGrubu: null })
      expect(sahlep.denetimler.some((d) => d.anahtar === "recete")).toBe(true)
    }
  })

  // Karar B: mevcut üründe ürünün KENDİ oranı; oturum oranı %10 olsa bile
  // %20'lik bira %20 ile net'lenir.
  it("mevcut üründe KDV ürünün kendisinden gelir, yeni üründe oturumdan (alkolde %20)", () => {
    const fark = farkListesiKur(
      [kalem("Efes", [[null, 150]], "Biralar"), kalem("Bomonti", [[null, 160]], "Biralar")],
      [urun("u1", "Efes", 100, { vatRate: 20 })],
      { oturumKdv: 10, tamMenu: false }
    )
    const efes = fark.find((f) => f.anahtar === "efes")!
    expect(efes.kova).toBe("FIYAT_DEGISMIS")
    if (efes.kova === "FIYAT_DEGISMIS") {
      expect(efes.kdvOrani).toBe(20)
      expect(efes.eskiBrut).toBe(120)
      expect(efes.yeniNet).toBe(125)
    }
    const bomonti = fark.find((f) => f.anahtar === "bomonti")!
    if (bomonti.kova === "YENI") expect(bomonti.oneri.kdvOrani).toBe(20)
  })

  it("fiyatı olmayan mevcut ürün 'fiyat değişmiş'e düşer (eski: —)", () => {
    const [f] = farkListesiKur([kalem("Çay", [[null, 40]])], [urun("u1", "Çay", null)], { oturumKdv: 10, tamMenu: false })
    expect(f.kova).toBe("FIYAT_DEGISMIS")
    if (f.kova === "FIYAT_DEGISMIS") expect(f.eskiBrut).toBeNull()
  })

  it("çok fiyatlı yeni satır seçenek grubu önerir; mevcut üründe uyarı yazar", () => {
    const fark = farkListesiKur(
      [kalem("Latte", [["Küçük", 90], ["Büyük", 110]]), kalem("Mocha", [["Küçük", 100], ["Büyük", 120]])],
      [urun("u1", "Mocha", 90.909091, { secenekGrubu: 1 })],
      { oturumKdv: 10, tamMenu: false }
    )
    const latte = fark.find((f) => f.anahtar === "latte")!
    if (latte.kova === "YENI") {
      expect(latte.oneri.brut).toBe(90)
      expect(latte.oneri.secenekGrubu?.ad).toBe("Boy")
      expect(latte.oneri.secenekGrubu?.secenekler.map((s) => s.priceDelta)).toEqual([0, 20])
    }
    const mocha = fark.find((f) => f.anahtar === "mocha")!
    expect(mocha.kova).toBe("AYNI") // taban 100 = 90,909091 × 1,10
    expect(mocha.denetimler.some((d) => d.anahtar === "varyant")).toBe(true)
  })

  // Karar H: "menüde yok" yalnız TAMAMI işaretliyse; hizmet ve gizli ürün sayılmaz.
  it("'menüde yok' yalnız tamMenu'de listelenir ve satılabilir mal ürünleriyle sınırlıdır", () => {
    const urunler = [
      urun("u1", "Çay", 36.363636),
      urun("u2", "Su", 10),
      urun("u3", "Servis", 50, { isService: true }),
      urun("u4", "Eski Ürün", 50, { isSellable: false }),
      urun("u5", "Pasif", 50, { isActive: false }),
    ]
    const yarim = farkListesiKur([kalem("Çay", [[null, 40]])], urunler, { oturumKdv: 10, tamMenu: false })
    expect(kovaSay(yarim).MENUDE_YOK).toBe(0)
    const tam = farkListesiKur([kalem("Çay", [[null, 40]])], urunler, { oturumKdv: 10, tamMenu: true })
    const yok = tam.filter((f) => f.kova === "MENUDE_YOK")
    expect(yok.map((f) => f.anahtar)).toEqual(["urun:u2"])
  })

  it("pasif ya da gizli mevcut ürün eşleşir ama denetim söyler", () => {
    const fark = farkListesiKur([kalem("Çay", [[null, 40]])], [urun("u1", "Çay", 36.363636, { isActive: false, isSellable: false })], { oturumKdv: 10, tamMenu: false })
    expect(fark[0].kova).toBe("AYNI")
    expect(fark[0].denetimler.map((d) => d.anahtar)).toEqual(expect.arrayContaining(["pasif", "gizli"]))
  })
})
