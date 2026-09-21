import { describe, expect, it } from "vitest"
import { fiyatSayisi, menuNormalize, paraBirimiNormalize } from "./normalize"

describe("menuNormalize", () => {
  it("kalemleri, bölümleri ve fiyatları güvenli tipe indirir", () => {
    const o = menuNormalize(
      {
        bolumler: ["SICAK İÇECEKLER", "  ", null],
        kalemler: [
          { ad: " Latte ", aciklama: "espresso, süt", bolum: "SICAK İÇECEKLER", fiyatlar: [{ etiket: "Küçük", fiyat: 90 }, { etiket: "Büyük", fiyat: 110.004 }] },
          { ad: "Türk Kahvesi", aciklama: null, bolum: null, fiyatlar: [{ etiket: null, fiyat: 60 }] },
        ],
        kdvNotu: "Fiyatlarımıza KDV dahildir",
        paraBirimi: "₺",
        guven: { kalemler: 0.9, fiyatlar: 1.4, bolumler: -1 },
      },
      2
    )
    expect(o.bolumler).toEqual(["SICAK İÇECEKLER"])
    expect(o.kalemler).toHaveLength(2)
    expect(o.kalemler[0]).toMatchObject({ ad: "Latte", bolum: "SICAK İÇECEKLER", sayfa: 2 })
    expect(o.kalemler[0].fiyatlar).toEqual([{ etiket: "Küçük", fiyat: 90 }, { etiket: "Büyük", fiyat: 110 }])
    expect(o.kalemler[1].fiyatlar).toEqual([{ etiket: null, fiyat: 60 }])
    expect(o.paraBirimi).toBe("TRY")
    expect(o.guven).toEqual({ kalemler: 0.9, fiyatlar: 1, bolumler: 0 })
  })

  // §3.7 "başlık ürün sanılmış": fiyatsız ya da ₺0 satır kalem değil, ama
  // sessizce de yutulmaz — sayısı denetime gider.
  it("fiyatsız / sıfır fiyatlı satırı atar ve sayar", () => {
    const o = menuNormalize(
      { kalemler: [{ ad: "TATLILAR", fiyatlar: [] }, { ad: "Sütlaç", fiyatlar: [{ etiket: null, fiyat: 0 }] }, { ad: "Kazandibi", fiyatlar: [{ etiket: null, fiyat: 85 }] }] },
      1
    )
    expect(o.kalemler.map((k) => k.ad)).toEqual(["Kazandibi"])
    expect(o.fiyatsizSatir).toBe(2)
  })

  it("sağlayıcı şemayı yok sayıp dize/dizi dönerse de okur", () => {
    const o = menuNormalize({ kalemler: [{ ad: "Çay", fiyat: "40,00 TL" }, { ad: "Kahve", fiyatlar: ["₺1.250"] }] }, 1)
    expect(o.kalemler[0].fiyatlar).toEqual([{ etiket: null, fiyat: 40 }])
    expect(o.kalemler[1].fiyatlar).toEqual([{ etiket: null, fiyat: 1250 }])
    const dizi = menuNormalize([{ ad: "Su", fiyatlar: [{ etiket: null, fiyat: 15 }] }], 3)
    expect(dizi.kalemler).toHaveLength(1)
    expect(dizi.kalemler[0].sayfa).toBe(3)
  })
})

describe("fiyatSayisi", () => {
  it("Türk biçimini çözer", () => {
    expect(fiyatSayisi("120,50")).toBe(120.5)
    expect(fiyatSayisi("1.250")).toBe(1250)
    expect(fiyatSayisi("1.250,75")).toBe(1250.75)
    expect(fiyatSayisi("120.-")).toBe(120)
    expect(fiyatSayisi("₺ 95")).toBe(95)
    expect(fiyatSayisi("abc")).toBeNull()
    expect(fiyatSayisi(null)).toBeNull()
  })
})

describe("paraBirimiNormalize", () => {
  it("simgeleri koda çevirir", () => {
    expect(paraBirimiNormalize("TL")).toBe("TRY")
    expect(paraBirimiNormalize("$")).toBe("USD")
    expect(paraBirimiNormalize("eur")).toBe("EUR")
    expect(paraBirimiNormalize("gbp")).toBe("GBP")
    expect(paraBirimiNormalize("lira")).toBeNull()
  })
})
