import { describe, expect, it } from "vitest"
import { sinifNormalize, turNormalize, unvanEslesiyorMu, yonBul } from "./normalize"

const FIRMA = { vkn: "7352344835", unvan: "REYPO BİLİŞİM ANONİM ŞİRKETİ" }

describe("turNormalize", () => {
  it("küme içi değeri biçimden bağımsız tanır, dışını DIGER yapar", () => {
    expect(turNormalize("fatura")).toBe("FATURA")
    expect(turNormalize(" İRSALİYE ")).toBe("IRSALIYE")
    expect(turNormalize("Çek")).toBe("CEK")
    expect(turNormalize("PROFORMA")).toBe("DIGER")
    expect(turNormalize(null)).toBe("DIGER")
  })
})

describe("yonBul", () => {
  it("VKN eşleşmesi kesin dayanaktır", () => {
    expect(
      yonBul({ duzenleyenVknTckn: "1111111111", duzenleyenUnvan: "X", muhatapVknTckn: "735 234 4835", muhatapUnvan: "Y" }, FIRMA)
    ).toEqual({ yon: "ALIS", dayanak: "vkn", yabanci: false })
    expect(
      yonBul({ duzenleyenVknTckn: "7352344835", duzenleyenUnvan: null, muhatapVknTckn: null, muhatapUnvan: null }, FIRMA)
    ).toEqual({ yon: "SATIS", dayanak: "vkn", yabanci: false })
  })

  it("VKN yoksa ünvan zayıf dayanaktır", () => {
    expect(
      yonBul({ duzenleyenVknTckn: null, duzenleyenUnvan: "Ahmet Ltd", muhatapVknTckn: null, muhatapUnvan: "Reypo Bilisim A.S." }, FIRMA)
    ).toEqual({ yon: "ALIS", dayanak: "unvan", yabanci: false })
  })

  it("iki VKN de okunmuş ve ikisi de biz değilsek belge yabancıdır", () => {
    expect(
      yonBul({ duzenleyenVknTckn: "1111111111", duzenleyenUnvan: "A", muhatapVknTckn: "2222222222", muhatapUnvan: "B" }, FIRMA)
    ).toEqual({ yon: "BELIRSIZ", dayanak: "yok", yabanci: true })
    // Tek VKN okunmuşsa yabancı DENMEZ — öteki taraf biz olabiliriz.
    expect(
      yonBul({ duzenleyenVknTckn: "1111111111", duzenleyenUnvan: "A", muhatapVknTckn: null, muhatapUnvan: null }, FIRMA).yabanci
    ).toBe(false)
  })
})

describe("unvanEslesiyorMu", () => {
  it("ilk iki anlamlı kelime yeter, tüzel kişilik ekleri yok sayılır", () => {
    expect(unvanEslesiyorMu("REYPO BİLİŞİM A.Ş.", "Reypo Bilisim Anonim Sirketi")).toBe(true)
    expect(unvanEslesiyorMu("REYPO TEKSTİL", "REYPO BİLİŞİM")).toBe(false)
    expect(unvanEslesiyorMu("", "REYPO")).toBe(false)
  })
})

describe("sinifNormalize", () => {
  it("bozuk sayfa listesi [1] olur, güven 0-1'e kırpılır", () => {
    const [b] = sinifNormalize({ belgeler: [{ tur: "FATURA", sayfalar: "x", guven: 3, toplam: "12" }] }, FIRMA)
    expect(b.tur).toBe("FATURA")
    expect(b.sayfalar).toEqual([1])
    expect(b.guven).toBe(1)
    expect(b.toplam).toBeNull()
    expect(b.yon).toBe("BELIRSIZ")
  })
})
