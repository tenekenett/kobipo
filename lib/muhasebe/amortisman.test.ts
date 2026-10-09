// Demirbaş amortismanı (amortisman.ts).

import { describe, expect, it } from "vitest"
import { amortismanTablosu, birikmisAmortisman, birikmisHesabi, oncekiAmortismanOnerisi, type DemirbasGirdisi } from "./amortisman"

const d = (x: Partial<DemirbasGirdisi>): DemirbasGirdisi => ({
  id: "a1",
  ad: "Dizüstü bilgisayar",
  hesapKodu: "255",
  alisTarihi: new Date(Date.UTC(2026, 2, 10)),
  maliyet: 30000,
  omur: 4,
  yontem: "NORMAL",
  oncekiAmortisman: 0,
  cikisTarihi: null,
  ...x,
})

describe("amortisman", () => {
  it("normal: eşit tutarlar, alındığı yıl tam yıl", () => {
    expect(amortismanTablosu(d({}), 2026).map((s) => [s.yil, s.tutar])).toEqual([
      [2026, 7500],
      [2027, 7500],
      [2028, 7500],
      [2029, 7500],
    ])
  })

  it("azalan bakiyeler: oran iki kat (en çok %50), son yıl kalanın tamamı", () => {
    const t = amortismanTablosu(d({ yontem: "AZALAN" }), 2026)
    expect(t.map((s) => s.tutar)).toEqual([15000, 7500, 3750, 3750])
    expect(t[t.length - 1].birikmis).toBe(30000)
  })

  it("defter öncesi yıllar priorDepreciation'dan devam eder", () => {
    const eski = d({ alisTarihi: new Date(Date.UTC(2024, 5, 1)), oncekiAmortisman: 15000 })
    expect(amortismanTablosu(eski, 2026).map((s) => [s.yil, s.tutar])).toEqual([
      [2026, 7500],
      [2027, 7500],
    ])
    expect(oncekiAmortismanOnerisi(eski, 2026)).toBe(15000)
    expect(birikmisAmortisman(eski, 2026, 2026)).toBe(22500)
  })

  it("elden çıkarıldığı yıl ve sonrası ayrılmaz", () => {
    const t = amortismanTablosu(d({ cikisTarihi: new Date(Date.UTC(2028, 0, 15)) }), 2026)
    expect(t.map((s) => s.yil)).toEqual([2026, 2027])
  })

  it("kuruş: üç yıllık 1000 TL → 333,33 + 333,33 + 333,34", () => {
    expect(amortismanTablosu(d({ maliyet: 1000, omur: 3 }), 2026).map((s) => s.tutar)).toEqual([333.33, 333.33, 333.34])
  })

  it("birikmiş hesabı: maddi 257, maddi olmayan 268", () => {
    expect(birikmisHesabi("255.01")).toBe("257")
    expect(birikmisHesabi("260")).toBe("268")
    expect(birikmisHesabi("264")).toBe("268")
  })
})
