import { describe, expect, it } from "vitest"
import { anahtarTuru, eslemeAnahtari, eslemeBekliyorMu, eslemeGruplari, grupEtiketi, type BekleyenSatir } from "./esleme"

let sira = 0
const satir = (s: Partial<BekleyenSatir>): BekleyenSatir => ({
  id: `l${++sira}`,
  voucherId: "v1",
  role: "ALIS",
  side: "DEBIT",
  amount: 100,
  learnKeys: [],
  suggestedCode: "770",
  description: "Gider / hizmet alışı",
  accountId: null,
  accountSource: "NONE",
  ...s,
})

describe("eslemeBekliyorMu", () => {
  it("hesapsız satır bekler", () => {
    expect(eslemeBekliyorMu(satir({}))).toBe(true)
  })
  it("tahmin rolünde varsayılan hesap bekler, tahmin olmayanda beklemez", () => {
    expect(eslemeBekliyorMu(satir({ accountId: "a", accountSource: "DEFAULT", role: "ALIS" }))).toBe(true)
    expect(eslemeBekliyorMu(satir({ accountId: "a", accountSource: "DEFAULT", role: "KDV_INDIRILECEK" }))).toBe(false)
  })
  it("elle seçilmiş ve öğrenilmiş satır beklemez", () => {
    expect(eslemeBekliyorMu(satir({ accountId: "a", accountSource: "USER" }))).toBe(false)
    expect(eslemeBekliyorMu(satir({ accountId: "a", accountSource: "LEARNED" }))).toBe(false)
  })
  it("alt hesap, elle ve açılış farkı satırı eşlemeye girmez (hesapsız olsa da)", () => {
    for (const role of ["CARI", "PARA", "PARA_KARSI", "PERSONEL", "MANUEL", "ACILIS_FARK"]) {
      expect(eslemeBekliyorMu(satir({ role }))).toBe(false)
    }
  })
})

describe("eslemeAnahtari", () => {
  it("öğrenme anahtarlarının sırası önemsiz", () => {
    expect(eslemeAnahtari(satir({ learnKeys: ["b", "a"] }))).toBe(eslemeAnahtari(satir({ learnKeys: ["a", "b"] })))
  })
  it("aynı anahtar farklı rolde ayrı grup", () => {
    expect(eslemeAnahtari(satir({ learnKeys: ["x"], role: "ALIS" }))).not.toBe(eslemeAnahtari(satir({ learnKeys: ["x"], role: "GIDER" })))
  })
  it("anahtarsız satır rol + önerilen kod + açıklamayla", () => {
    expect(eslemeAnahtari(satir({ role: "KARSI", suggestedCode: "500", description: "Açılış" }))).toBe("KARSI|∅|500|Açılış")
  })
})

describe("eslemeGruplari", () => {
  it("aynı tedarikçi + oranın satırlarını tek grupta toplar, fiş sayısını tekil sayar", () => {
    const k = ["alis:cari-kdv:t1:20"]
    const gruplar = eslemeGruplari([
      satir({ voucherId: "v1", learnKeys: k, amount: 100 }),
      satir({ voucherId: "v1", learnKeys: k, amount: 50 }),
      satir({ voucherId: "v2", learnKeys: k, amount: 25.555 }),
      satir({ voucherId: "v3", learnKeys: ["alis:cari-kdv:t2:20"], amount: 10 }),
      satir({ voucherId: "v4", learnKeys: k, accountSource: "USER", accountId: "x" }), // beklemiyor
    ])
    expect(gruplar).toHaveLength(2)
    expect(gruplar[0]).toMatchObject({ satirSayisi: 3, fisSayisi: 2, tutar: 175.56, ogrenmeAnahtarlari: k, taraf: "B" })
    expect(gruplar[1].fisSayisi).toBe(1)
  })
  it("tahmin hesabı tekse gösterir, karışıksa göstermez", () => {
    const k = ["gider:kategori:kira"]
    const tek = eslemeGruplari([
      satir({ role: "GIDER", learnKeys: k, accountId: "770", accountSource: "DEFAULT" }),
      satir({ role: "GIDER", learnKeys: k, accountId: "770", accountSource: "DEFAULT" }),
    ])
    expect(tek[0].tahminHesapId).toBe("770")
    const karisik = eslemeGruplari([
      satir({ role: "GIDER", learnKeys: k, accountId: "770", accountSource: "DEFAULT" }),
      satir({ role: "GIDER", learnKeys: k }),
    ])
    expect(karisik[0].tahminHesapId).toBeNull()
  })
  it("en çok fişi tutan grup önce gelir", () => {
    const g = eslemeGruplari([
      satir({ voucherId: "a", learnKeys: ["x"] }),
      satir({ voucherId: "b", learnKeys: ["y"] }),
      satir({ voucherId: "c", learnKeys: ["y"] }),
    ])
    expect(g.map((x) => x.ogrenmeAnahtarlari[0])).toEqual(["y", "x"])
  })
})

describe("grupEtiketi", () => {
  const adlar = { tedarikci: new Map([["t1", "ACME Ltd"]]), urun: new Map([["p1", "Kalem"]]) }
  it("tedarikçi + oran", () => {
    expect(grupEtiketi({ ogrenmeAnahtarlari: ["alis:cari-kdv:t1:20"], aciklama: "", rol: "ALIS" }, adlar)).toBe("ACME Ltd · KDV %20 alışları")
  })
  it("ürün; silinmiş kayıt adı söylenir", () => {
    expect(grupEtiketi({ ogrenmeAnahtarlari: ["alis:urun:p1"], aciklama: "", rol: "ALIS" }, adlar)).toBe("Kalem (alış)")
    expect(grupEtiketi({ ogrenmeAnahtarlari: ["alis:urun:yok"], aciklama: "", rol: "ALIS" }, adlar)).toBe("Silinmiş ürün (alış)")
  })
  it("kategori adı satırın açıklamasından; kategorisiz '-'", () => {
    expect(grupEtiketi({ ogrenmeAnahtarlari: ["gider:kategori:kira"], aciklama: "Kira", rol: "GIDER" }, adlar)).toBe("Faturasız gider · Kira")
    expect(grupEtiketi({ ogrenmeAnahtarlari: ["gider:kategori:-"], aciklama: "Faturasız gider", rol: "GIDER" }, adlar)).toBe(
      "Faturasız gider · kategorisiz",
    )
  })
  it("sabit anahtarlar ve anahtarsız grup", () => {
    expect(grupEtiketi({ ogrenmeAnahtarlari: ["bordro:gider"], aciklama: "", rol: "BORDRO_GIDER" }, adlar)).toBe("Bordro gideri (brüt ücretler)")
    expect(grupEtiketi({ ogrenmeAnahtarlari: [], aciklama: "Virman karşılığı", rol: "KARSI" }, adlar)).toBe("Virman karşılığı")
  })
  it("çok anahtarlı grup en çok üç ad + kalan sayısı", () => {
    const urun = new Map([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]])
    const etiket = grupEtiketi(
      { ogrenmeAnahtarlari: ["alis:urun:a", "alis:urun:b", "alis:urun:c", "alis:urun:d"], aciklama: "", rol: "ALIS" },
      { tedarikci: new Map(), urun },
    )
    expect(etiket).toBe("A (alış), B (alış), C (alış) +1")
  })
})

describe("anahtarTuru", () => {
  it("bilinmeyen anahtar null", () => {
    expect(anahtarTuru("baska:bir:sey")).toBeNull()
  })
  it("kategori adı ':' içerse de bütün kalır", () => {
    expect(anahtarTuru("gider:kategori:a:b")).toEqual({ tur: "kategori", yon: "gider", kategori: "a:b" })
  })
})
