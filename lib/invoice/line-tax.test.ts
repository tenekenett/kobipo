import { describe, expect, it } from "vitest"
import {
  addLineTax,
  applyGlobalAdjustment,
  computeLineTax,
  emptyLineTaxSums,
  lineTotalFactor,
  solveNetFromTotal,
} from "./line-tax"
import { GEKAP_TAX_CODE } from "@/lib/integrations/e-invoice/gib-tax-types"

const r2 = (x: number) => Math.round(x * 100) / 100

describe("computeLineTax", () => {
  it("ÖTV/GEKAP yokken KDV doğrudan net üzerinden hesaplanır", () => {
    const t = computeLineTax(1000, { vatRate: 20 })
    expect(t.vatBase).toBe(1000)
    expect(t.vat).toBe(200)
    expect(t.total).toBe(1200)
  })

  it("ÖTV mal/hizmet bedeline eklenir, KDV toplam üzerinden hesaplanır", () => {
    const t = computeLineTax(1000, { vatRate: 20, exciseRate: 20, exciseCode: "0074" })
    expect(t.excise).toBe(200)
    expect(t.vatBase).toBe(1200) // net + ÖTV
    expect(t.vat).toBe(240) // 200 DEĞİL
    expect(t.total).toBe(1440)
  })

  it("GEKAP da matraha girer (kullanıcının onayladığı örnek)", () => {
    const t = computeLineTax(1000, {
      vatRate: 20,
      otherTaxRate: 6,
      otherTaxCode: GEKAP_TAX_CODE,
    })
    expect(t.otherTax).toBe(60)
    expect(t.otherTaxInBase).toBe(60)
    expect(t.vatBase).toBe(1060)
    expect(t.vat).toBe(212)
    expect(t.total).toBe(1272)
  })

  it("ÖTV + GEKAP birlikte tek matrahta toplanır", () => {
    const t = computeLineTax(1000, {
      vatRate: 20,
      exciseRate: 10,
      exciseCode: "0074",
      otherTaxRate: 5,
      otherTaxCode: GEKAP_TAX_CODE,
    })
    expect(t.vatBase).toBe(1150)
    expect(t.vat).toBe(230)
    expect(t.total).toBe(1380)
  })

  it("Konaklama Vergisi matrahın ÜSTÜNE eklenir — KDV'yi büyütmez", () => {
    const t = computeLineTax(1000, { vatRate: 20, otherTaxRate: 2, otherTaxCode: "0059" })
    expect(t.otherTax).toBe(20)
    expect(t.otherTaxInBase).toBe(0)
    expect(t.vatBase).toBe(1000)
    expect(t.vat).toBe(200)
    expect(t.total).toBe(1220)
  })

  it("ÖİV (4080) de matrahın dışındadır", () => {
    const t = computeLineTax(1000, { vatRate: 20, otherTaxRate: 10, otherTaxCode: "4080" })
    expect(t.vatBase).toBe(1000)
    expect(t.vat).toBe(200)
  })

  it("kodu tanınmayan diğer vergi matraha GİRMEZ (güvenli varsayılan)", () => {
    const t = computeLineTax(1000, { vatRate: 20, otherTaxRate: 8, otherTaxCode: "9999" })
    expect(t.otherTaxInBase).toBe(0)
    expect(t.vat).toBe(200)
  })

  it("tevkifat ÖTV'li büyümüş KDV üzerinden kesilir", () => {
    const t = computeLineTax(1000, {
      vatRate: 20,
      exciseRate: 20,
      exciseCode: "0074",
      withholdingRate: 50,
    })
    expect(t.vat).toBe(240)
    expect(t.withholding).toBe(120)
    expect(t.total).toBe(1320) // 1000 + 200 + 240 - 120
  })

  it("KDV %0 satırda ÖTV yine bedele eklenir ama KDV doğmaz", () => {
    const t = computeLineTax(1000, { vatRate: 0, exciseRate: 20, exciseCode: "0074" })
    expect(t.vatBase).toBe(1200)
    expect(t.vat).toBe(0)
    expect(t.total).toBe(1200)
  })

  it("maktu GEKAP miktarla çarpılır ve matraha girer", () => {
    // 100 adet × 0,60 ₺ = 60 ₺ → matrah 1.060, KDV 212, ödenecek 1.272
    const t = computeLineTax(1000, { vatRate: 20, quantity: 100, gekapUnitAmount: 0.6 })
    expect(t.gekap).toBe(60)
    expect(t.vatBase).toBe(1060)
    expect(t.vat).toBe(212)
    expect(t.total).toBe(1272)
  })

  it("maktu GEKAP satır iskontosundan ETKİLENMEZ", () => {
    // Aynı satır %20 iskontolu: net 800'e düşer ama GEKAP 60 ₺ sabit kalır.
    const t = computeLineTax(800, { vatRate: 20, quantity: 100, gekapUnitAmount: 0.6 })
    expect(t.gekap).toBe(60)
    expect(t.vatBase).toBe(860)
    expect(t.vat).toBe(172)
  })

  it("maktu GEKAP varken oransal GEKAP tamamen yok sayılır", () => {
    const t = computeLineTax(1000, {
      vatRate: 20,
      quantity: 100,
      gekapUnitAmount: 0.6,
      otherTaxRate: 6,
      otherTaxCode: GEKAP_TAX_CODE,
    })
    expect(t.gekap).toBe(60)
    expect(t.otherTax).toBe(0) // çift sayım yok
    expect(t.otherTaxInBase).toBe(0)
    expect(t.vatBase).toBe(1060)
    expect(t.total).toBe(1272)
  })

  it("maktu GEKAP, GEKAP olmayan diğer vergiyi susturmaz", () => {
    const t = computeLineTax(1000, {
      vatRate: 20,
      quantity: 100,
      gekapUnitAmount: 0.6,
      otherTaxRate: 2,
      otherTaxCode: "0059", // Konaklama — matrah dışı
    })
    expect(t.gekap).toBe(60)
    expect(t.otherTax).toBe(20)
    expect(t.vatBase).toBe(1060)
    expect(t.total).toBe(1292) // 1000 + 60 + 20 + 212
  })

  it("nonScalingTotal = GEKAP + KDV'si − tevkifatı", () => {
    const t = computeLineTax(1000, {
      vatRate: 20,
      quantity: 100,
      gekapUnitAmount: 0.6,
      withholdingRate: 50,
    })
    expect(t.gekapVat).toBe(12) // 60 × %20
    expect(t.gekapWithholding).toBe(6) // 12 × %50
    expect(t.nonScalingTotal).toBe(66) // 60 + 12 − 6
  })

  it("boş/geçersiz oranlar 0 sayılır", () => {
    const t = computeLineTax(1000, {
      vatRate: null,
      exciseRate: undefined,
      otherTaxRate: Number.NaN,
      withholdingRate: null,
    })
    expect(t.total).toBe(1000)
  })
})

describe("applyGlobalAdjustment", () => {
  const build = (lines: Array<{ net: number } & Record<string, unknown>>) => {
    const sums = emptyLineTaxSums()
    for (const { net, ...rates } of lines) addLineTax(sums, net, computeLineTax(net, rates))
    return sums
  }

  it("GEKAP'sız faturada her şey tek katsayıyla ölçeklenir", () => {
    const sums = build([{ net: 1000, vatRate: 20 }])
    const adj = applyGlobalAdjustment(sums, 900) // %10 fatura iskontosu
    expect(adj.net).toBe(900)
    expect(adj.vat).toBe(180)
    expect(adj.total).toBe(1080)
  })

  it("maktu GEKAP fatura altı iskontodan ETKİLENMEZ", () => {
    // net 1.000 + GEKAP 60 → KDV 212, toplam 1.272.
    // %10 fatura iskontosu: net 900 olur, GEKAP 60 SABİT kalır.
    // Yeni matrah 960 → KDV 192 → toplam 900 + 60 + 192 = 1.152.
    const sums = build([{ net: 1000, vatRate: 20, quantity: 100, gekapUnitAmount: 0.6 }])
    const adj = applyGlobalAdjustment(sums, 900)
    expect(adj.net).toBe(900)
    expect(adj.gekap).toBe(60) // ölçeklenmedi
    expect(r2(adj.vatBase)).toBe(960)
    expect(r2(adj.vat)).toBe(192)
    expect(r2(adj.total)).toBe(1152)
  })

  it("ÖTV ölçeklenir ama GEKAP ölçeklenmez (ikisi bir arada)", () => {
    const sums = build([
      { net: 1000, vatRate: 20, exciseRate: 20, exciseCode: "0074", quantity: 100, gekapUnitAmount: 0.6 },
    ])
    const adj = applyGlobalAdjustment(sums, 500) // matrah yarıya iner
    expect(r2(adj.excise)).toBe(100) // 200 → 100 (oransal)
    expect(adj.gekap).toBe(60) // sabit
    expect(r2(adj.vatBase)).toBe(660) // 500 + 100 + 60
    expect(r2(adj.vat)).toBe(132)
    expect(r2(adj.total)).toBe(792) // 500 + 100 + 60 + 132
  })

  it("fatura altı İLAVE de aynı kuralı izler (katsayı > 1)", () => {
    const sums = build([{ net: 1000, vatRate: 20, quantity: 100, gekapUnitAmount: 0.6 }])
    const adj = applyGlobalAdjustment(sums, 1200)
    expect(adj.gekap).toBe(60)
    expect(r2(adj.vatBase)).toBe(1260)
    expect(r2(adj.vat)).toBe(252)
  })

  it("tevkifat da GEKAP payı kadar sabit kalır", () => {
    const sums = build([
      { net: 1000, vatRate: 20, withholdingRate: 50, quantity: 100, gekapUnitAmount: 0.6 },
    ])
    const adj = applyGlobalAdjustment(sums, 900)
    // KDV 192 → tevkifat 96; GEKAP payı (12 × %50 = 6) korunmuş olmalı.
    expect(r2(adj.vat)).toBe(192)
    expect(r2(adj.withholding)).toBe(96)
    expect(r2(adj.total)).toBe(1056) // 900 + 60 + 192 − 96
  })

  it("net 0 ise katsayı 0 olur ama maktu GEKAP yine durur", () => {
    const sums = build([{ net: 0, vatRate: 20, quantity: 100, gekapUnitAmount: 0.6 }])
    const adj = applyGlobalAdjustment(sums, 0)
    expect(adj.gekap).toBe(60)
    expect(r2(adj.total)).toBe(72) // 60 + KDV 12
  })
})

describe("solveNetFromTotal", () => {
  // Editörde kullanıcı "Tutar" (KDV dahil) yazdığında birim fiyat buradan geriye
  // çözülür — computeLineTax'in tersi olmak ZORUNDA.
  const cases = [
    { vatRate: 20 },
    { vatRate: 20, exciseRate: 20, exciseCode: "0074" },
    { vatRate: 10, otherTaxRate: 6, otherTaxCode: GEKAP_TAX_CODE },
    { vatRate: 20, otherTaxRate: 2, otherTaxCode: "0059" },
    { vatRate: 18, exciseRate: 6.7, exciseCode: "0071", withholdingRate: 50 },
    { vatRate: 20, exciseRate: 25, exciseCode: "0074", otherTaxRate: 4, otherTaxCode: GEKAP_TAX_CODE, withholdingRate: 20 },
    // Maktu GEKAP: toplam artık net'in katı değil, affin — sabit yük önce düşülür.
    { vatRate: 20, quantity: 100, gekapUnitAmount: 0.6 },
    { vatRate: 20, quantity: 40, gekapUnitAmount: 1.25, exciseRate: 10, exciseCode: "0074", withholdingRate: 50 },
    // Maktu varken oransal GEKAP susar — ters çözüm de aynı kuralı görmeli.
    { vatRate: 20, quantity: 10, gekapUnitAmount: 2, otherTaxRate: 6, otherTaxCode: GEKAP_TAX_CODE },
  ]

  it.each(cases)("istenen toplamdan çözülen net aynı toplamı verir (%o)", (rates) => {
    const desiredTotal = 12_345.67
    const net = solveNetFromTotal(desiredTotal, rates)
    expect(net).not.toBeNull()
    expect(r2(computeLineTax(net as number, rates).total)).toBe(r2(desiredTotal))
  })

  it("hedef sabit GEKAP yükünün altındaysa çözmez (null)", () => {
    // 100 × 5 ₺ = 500 ₺ GEKAP + KDV'si; 100 ₺'lik hedef karşılanamaz.
    expect(solveNetFromTotal(100, { vatRate: 20, quantity: 100, gekapUnitAmount: 5 })).toBeNull()
  })

  it("çarpan 0 ise çözmez (tamamı tevkif edilen KDV'siz satır)", () => {
    expect(solveNetFromTotal(1000, { vatRate: 0, exciseRate: -100 })).toBeNull()
  })

  it("lineTotalFactor GEKAP'sız satırda klasik çarpanı verir", () => {
    expect(r2(lineTotalFactor({ vatRate: 20, exciseRate: 20, exciseCode: "0074" }))).toBe(1.44)
  })
})
