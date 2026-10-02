// Fatura altı iskonto/ilave — kalemin belgedeki karşılığı (fatura-alti.ts).
//
// Ölçü belgenin KENDİ hesabıdır: kalemler `createInvoiceFromBody` gibi
// saklanır (satır iskontosu düşülmüş net üzerinden `computeLineTax`, kuruşa
// yuvarlı), sonra Σ belgedeki karşılık `computeInvoiceTotals`ın başlığıyla
// karşılaştırılır. Fark yalnız satır başı kuruş yuvarlaması kadar olabilir.

import { describe, expect, it } from "vitest"
import { computeInvoiceTotals, type DocumentAdjustments, type DocumentLineInput } from "@/lib/invoice/document-totals"
import { computeLineTax } from "@/lib/invoice/line-tax"
import { belgedekiKalem, faturaAltiCarpani } from "./fatura-alti"

const r2 = (n: number) => Math.round(n * 100) / 100

type Satir = Required<Pick<DocumentLineInput, "quantity" | "unitPrice" | "vatRate">> & DocumentLineInput

/** Kalemi veritabanına yazıldığı gibi kurar (create-invoice.ts ile aynı). */
function sakla(s: Satir) {
  const q = Number(s.quantity)
  const brut = q * Number(s.unitPrice)
  const disc = Number(s.discountAmount ?? 0)
  const tax = computeLineTax(brut - disc, {
    vatRate: Number(s.vatRate),
    exciseRate: Number(s.exciseRate ?? 0),
    otherTaxRate: Number(s.otherTaxRate ?? 0),
    otherTaxCode: s.otherTaxCode ?? null,
    withholdingRate: Number(s.withholdingRate ?? 0),
    quantity: q,
    gekapUnitAmount: Number(s.gekapUnitAmount ?? 0),
  })
  return {
    quantity: q,
    unitPrice: Number(s.unitPrice),
    discountAmount: disc,
    vatRate: Number(s.vatRate),
    withholdingRate: Number(s.withholdingRate ?? 0),
    gekapAmount: r2(tax.gekap),
    vatAmount: r2(tax.vat),
    withholdingAmount: r2(tax.withholding),
    totalAmount: r2(tax.total),
  }
}

/** Σ belgedeki karşılık ↔ belgenin başlığı. */
function karsilastir(satirlar: Satir[], adj: DocumentAdjustments, receipt = false) {
  const kalemler = satirlar.map(sakla)
  const f = faturaAltiCarpani(kalemler, adj)
  const belge = kalemler.map((k) => belgedekiKalem(k, f))
  const t = computeInvoiceTotals(satirlar, adj, { receipt })
  const topla = (pick: (b: (typeof belge)[number]) => number) => belge.reduce((s, b) => s + pick(b), 0)
  // Ödenecekten belge yuvarlaması çıkarılır: o kalemde değil başlıkta durur.
  const rounding = Number(adj.payableRoundingAmount ?? 0)
  return {
    f,
    kdv: [topla((b) => b.kdv), t.vat],
    tevkifat: [topla((b) => b.tevkifat), t.withholding],
    net: [topla((b) => b.net), t.net],
    toplam: [topla((b) => b.toplam), t.total - rounding],
    pay: topla((b) => b.faturaAltiPay),
  }
}

const KURUS = 0.02
const yakin = ([a, b]: number[]) => expect(Math.abs(a - b)).toBeLessThanOrEqual(KURUS)

describe("faturaAltiCarpani", () => {
  it("iskontosuz ve ilavesiz belgede 1 — kalem değerleri AYNEN kalır", () => {
    const k = sakla({ quantity: 3, unitPrice: 33.335, vatRate: 20, discountAmount: 5 })
    expect(faturaAltiCarpani([k], {})).toBe(1)
    expect(faturaAltiCarpani([k], { globalDiscountAmount: 0, globalChargeAmount: null })).toBe(1)
    const b = belgedekiKalem(k, 1)
    expect(b.kdv).toBe(k.vatAmount)
    expect(b.toplam).toBe(k.totalAmount)
    expect(b.faturaAltiPay).toBe(0)
  })

  it("iskonto ara toplamı aşamaz; ara toplam sıfırsa ölçeklenmez", () => {
    const k = sakla({ quantity: 1, unitPrice: 100, vatRate: 20 })
    expect(faturaAltiCarpani([k], { globalDiscountAmount: 500 })).toBe(0)
    expect(faturaAltiCarpani([{ quantity: 0, unitPrice: 100 }], { globalDiscountAmount: 10 })).toBe(1)
  })
})

describe("belgedekiKalem ↔ belgenin kendi hesabı (document-totals)", () => {
  it("gerçek örnek SAT-2026-0120: 2.692,50 × %20, fatura altı 726,98", () => {
    const r = karsilastir([{ quantity: 1, unitPrice: 2692.5, vatRate: 20 }], { globalDiscountAmount: 726.98 })
    yakin(r.kdv)
    // 1.965,52 × %20. (Canlı belgede 393,11 yazıyor: matrahı 1.965,53 —
    // bugünkü kuruş kuralından önce kaydedilmiş.)
    expect(r2(r.kdv[0])).toBe(393.1)
    yakin(r.net)
    yakin(r.toplam)
    expect(r2(r.pay)).toBe(726.98)
  })

  it("farklı KDV oranlı satırlar ve satır iskontosu", () => {
    const r = karsilastir(
      [
        { quantity: 4, unitPrice: 125.5, vatRate: 20, discountAmount: 20 },
        { quantity: 7, unitPrice: 33.333, vatRate: 10 },
        { quantity: 2, unitPrice: 80, vatRate: 1 },
      ],
      { globalDiscountAmount: 151.37 },
    )
    yakin(r.kdv)
    yakin(r.net)
    yakin(r.toplam)
  })

  it("fatura altı İLAVE matrahı büyütür (pay eksi)", () => {
    const r = karsilastir([{ quantity: 1, unitPrice: 2692.5, vatRate: 20 }], { globalChargeAmount: 41751.5 })
    // ALI-2026-0020: kalem 538,50 iken belge 8.888,80.
    expect(r2(r.kdv[0])).toBe(8888.8)
    yakin(r.kdv)
    yakin(r.toplam)
    expect(r.pay).toBeLessThan(0)
  })

  it("tevkifatlı satır: tevkifat da aynı oranda küçülür", () => {
    const r = karsilastir(
      [
        { quantity: 10, unitPrice: 450, vatRate: 20, withholdingRate: 50 },
        { quantity: 1, unitPrice: 999.99, vatRate: 20 },
      ],
      { globalDiscountAmount: 512.4 },
    )
    yakin(r.kdv)
    yakin(r.tevkifat)
    yakin(r.toplam)
  })

  it("maktu GEKAP ve KDV'si iskontoyla küçülmez", () => {
    const r = karsilastir(
      [
        { quantity: 100, unitPrice: 12.5, vatRate: 20, gekapUnitAmount: 0.75 },
        { quantity: 3, unitPrice: 200, vatRate: 20 },
      ],
      { globalDiscountAmount: 185 },
    )
    yakin(r.kdv)
    yakin(r.net)
    yakin(r.toplam)
  })

  it("ÖTV'li satır: ÖTV matrahla birlikte küçülür", () => {
    const r = karsilastir(
      [{ quantity: 2, unitPrice: 1500, vatRate: 20, exciseRate: 25 }],
      { globalDiscountAmount: 300 },
    )
    yakin(r.kdv)
    yakin(r.toplam)
  })

  it("FİŞ kuralı (yuvarlamasız toplam) da aynı katsayıyı kullanır", () => {
    const r = karsilastir(
      [
        { quantity: 3, unitPrice: 41.666667, vatRate: 10 },
        { quantity: 1, unitPrice: 83.333333, vatRate: 20 },
      ],
      { globalDiscountAmount: 17.5, payableRoundingAmount: 0.02 },
      true,
    )
    yakin(r.kdv)
    yakin(r.net)
    yakin(r.toplam)
  })
})
