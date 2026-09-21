/**
 * Kalem → ürün eşleşmesi. İki karar korunuyor: (1) anahtar sırası SATICI KODU ›
 * AD — aynı kodun adı faturadan faturaya değişir, kod değişmez; (2) bulanık
 * eşleşme YOK — yanlış ürüne stok girmek sessiz bir hatadır.
 */

import { describe, expect, it } from "vitest"
import { aliasAnahtari, kalemleriEsle, urunSozlugu } from "./alias"

describe("aliasAnahtari", () => {
  it("satıcı kodu varken ad kullanılmaz", () => {
    expect(aliasAnahtari({ saticiKodu: "ABC-1", ad: "Lastik 7.00-12" })).toEqual({ key: "kod:abc-1", label: "ABC-1", kaynak: "kod" })
    expect(aliasAnahtari({ saticiKodu: "   ", ad: "Lastik" })).toEqual({ key: "ad:lastik", label: "Lastik", kaynak: "ad" })
  })

  it("anahtar Türkçe duyarsız katlanır ve boşluk sadeleşir", () => {
    const a = aliasAnahtari({ saticiKodu: null, ad: "LASTİK  7.00-12" })
    const b = aliasAnahtari({ saticiKodu: null, ad: "lastik 7.00-12" })
    expect(a!.key).toBe(b!.key)
    // Etiket EKRANA gider: özgün yazım korunur.
    expect(a!.label).toBe("LASTİK  7.00-12")
  })

  it("ne kod ne ad okunduysa anahtar üretilmez", () => {
    expect(aliasAnahtari({ saticiKodu: null, ad: "  " })).toBeNull()
  })
})

describe("urunSozlugu", () => {
  it("kod, barkod ve ad aynı sözlüğe girer", () => {
    const s = urunSozlugu([{ id: "p1", name: "Lastik 7.00-12", code: "LST-700", barcode: "8690000000001" }])
    expect(s.get("lst-700")).toBe("p1")
    expect(s.get("8690000000001")).toBe("p1")
    expect(s.get("lastik 7.00-12")).toBe("p1")
  })

  it("aynı anahtarda ilk ürün kazanır", () => {
    const s = urunSozlugu([{ id: "p1", name: "Çivi" }, { id: "p2", name: "CIVI" }])
    expect(s.get("civi")).toBe("p1")
  })
})

describe("kalemleriEsle", () => {
  const sozluk = urunSozlugu([
    { id: "p1", name: "Lastik 7.00-12", code: "LST-700" },
    { id: "p2", name: "Şaft Yatağı", code: "SFT-1" },
  ])

  it("öğrenilmiş alias her şeyin önündedir", () => {
    const aliaslar = new Map([["kod:tdk-99", "p2"]])
    const e = kalemleriEsle([{ saticiKodu: "TDK-99", ad: "Lastik 7.00-12" }], aliaslar, sozluk)
    expect(e.get(0)).toEqual({ productId: "p2", kaynak: "alias" })
  })

  it("alias yoksa satıcı kodu bizim kod/barkodla tam eşleşir", () => {
    expect(kalemleriEsle([{ saticiKodu: "lst-700", ad: "Başka ad" }], new Map(), sozluk).get(0)).toEqual({ productId: "p1", kaynak: "kod" })
  })

  it("kod tutmazsa ad üzerinden (Türkçe duyarsız) eşleşir", () => {
    expect(kalemleriEsle([{ saticiKodu: null, ad: "şaft yatagı" }], new Map(), sozluk).get(0)).toEqual({ productId: "p2", kaynak: "ad" })
  })

  it("benzeyen ad eşleşme SAYILMAZ — kullanıcı seçer, alias öğrenilir", () => {
    const e = kalemleriEsle([{ saticiKodu: null, ad: "Lastik 700x12" }], new Map(), sozluk)
    expect(e.has(0)).toBe(false)
  })

  it("kodu olan kalemde AD alias'ı kullanılmaz (kod anahtarı bağlayıcıdır)", () => {
    const aliaslar = new Map([["ad:lastik 7.00-12", "p2"]])
    const e = kalemleriEsle([{ saticiKodu: "LST-700", ad: "Lastik 7.00-12" }], aliaslar, sozluk)
    expect(e.get(0)).toEqual({ productId: "p1", kaynak: "kod" })
  })

  it("kalem sırası korunur; eşleşmeyen satır haritada yoktur", () => {
    const e = kalemleriEsle([{ saticiKodu: null, ad: "Bilinmeyen" }, { saticiKodu: "SFT-1", ad: "x" }], new Map(), sozluk)
    expect(e.has(0)).toBe(false)
    expect(e.get(1)?.productId).toBe("p2")
  })
})
