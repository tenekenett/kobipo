import { describe, expect, it } from "vitest"
import {
  computeDocumentTotals,
  computeInvoiceTotals,
  documentColumnPrecision,
  invoiceTotalsFromStoredItems,
  resolveLineDiscount,
} from "@/lib/invoice/document-totals"
import {
  addLineTax,
  applyGlobalAdjustment,
  computeLineTax,
  emptyLineTaxSums,
} from "@/lib/invoice/line-tax"

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Reypo'da gerçek taslak UBL ile ölçülen örnek (2026-09-16): GİB'e giden belgede
 * ödenecek 31.906,39. Kalemler ve beklenen dip toplamlar devir notundan
 * (docs/finans/KURUS-FARKI.md).
 */
const reypoItems = [
  { quantity: 1, unitPrice: 12345.67, vatRate: 20, discountAmount: 1000 },
  { quantity: 3, unitPrice: 4999.99, vatRate: 20, discountAmount: 1250.5 },
  // %3 satır iskontosu: 583,333331 × 0,03 = 17,4999… → kuruşa yuvarlı 17,50
  { quantity: 7, unitPrice: 83.333333, vatRate: 10, discountAmount: 17.5, discountRate: 3 },
  { quantity: 2, unitPrice: 1499.5, vatRate: 1, discountAmount: 99.99 },
  { quantity: 1, unitPrice: 500, vatRate: 20 },
]
const reypoAdj = { globalDiscountAmount: 2000 }

describe("resmî belge kuralı (computeDocumentTotals)", () => {
  it("Reypo örneği: belgeyle kuruşu kuruşuna aynı — ödenecek 31.906,39", () => {
    const doc = computeDocumentTotals(reypoItems, reypoAdj)
    expect(doc.calculation).toEqual({
      lineExtensionAmount: 31427.97,
      taxExclusiveAmount: 27059.98,
      taxInclusiveAmount: 31906.39,
      allowanceTotalAmount: 4367.99,
      chargeTotalAmount: 0,
      payableRoundingAmount: 0,
      payableAmount: 31906.39,
    })
    expect(doc.subtotal).toBeCloseTo(29059.98, 2)
    expect(doc.globalDiscount).toBe(2000)
  })

  it("satır yuvarlaması toplam yuvarlamasından bir kuruş ayrışabilir — belge satırdan gider", () => {
    // 7 × 83,333333 = 583,333331 (KDV %10) iki satır. Satır satır: 583,33 + 58,33 = 641,66 → 1.283,32.
    // Yuvarlamasız toplam: 1.166,666662 + 116,666666 = 1.283,33. Eski kural ikinciyi
    // kaydediyor, GİB'e giden belge birinciyi yazıyordu; fark cari bakiyede kalıyordu.
    const items = [
      { quantity: 7, unitPrice: 83.333333, vatRate: 10 },
      { quantity: 7, unitPrice: 83.333333, vatRate: 10 },
    ]
    expect(computeInvoiceTotals(items, {}).total).toBe(1283.32)
    expect(round2(computeInvoiceTotals(items, {}, { receipt: true }).total)).toBe(1283.33)
  })

  it("her satır kuruşa yuvarlı; genel iskonto orantılı dağıtılır, artık son satıra", () => {
    const doc = computeDocumentTotals(reypoItems, reypoAdj)
    const shares = doc.lines.map((l) => l.globalShare)
    expect(shares).toEqual([780.84, 946.28, 38.94, 199.52, 34.42])
    expect(round2(shares.reduce((s, x) => s + x, 0))).toBe(2000)
    expect(doc.lines.map((l) => l.taxable)).toEqual([10564.83, 12803.19, 526.89, 2699.49, 465.58])
    expect(doc.lines.map((l) => l.rowVat)).toEqual([2112.97, 2560.64, 52.69, 26.99, 93.12])
    for (const l of doc.lines) {
      expect(l.taxable).toBe(round2(l.taxable))
      expect(l.rowVat).toBe(round2(l.rowVat))
      expect(l.lineDiscount).toBe(round2(l.lineDiscount))
      expect(l.rowTotal).toBe(round2(l.rowTotal))
    }
  })

  it("GİB dip toplam denklemi: brüt − iskonto + ilave = vergiler hariç (ilave ve GEKAP'la da)", () => {
    const items = [
      { quantity: 2, unitPrice: 333.33, vatRate: 20, discountAmount: 10 },
      { quantity: 1, unitPrice: 100, vatRate: 20, gekapUnitAmount: 0.5 },
      { quantity: 3, unitPrice: 19.99, vatRate: 10 },
    ]
    const doc = computeDocumentTotals(items, {
      globalDiscountAmount: 50,
      globalChargeAmount: 21.31,
      payableRoundingAmount: -0.02,
    })
    const c = doc.calculation
    expect(round2(c.lineExtensionAmount - c.allowanceTotalAmount + c.chargeTotalAmount)).toBe(c.taxExclusiveAmount)
    // İlave ve maktu GEKAP masraf olarak raporlanır, matrahın içindedir.
    expect(c.chargeTotalAmount).toBe(round2(21.31 + 0.5))
    expect(doc.globalCharge).toBe(21.31)
    // Dip toplam yuvarlaması KDV'ye girmez, yalnız ödenecek tutara eklenir.
    expect(c.payableRoundingAmount).toBe(-0.02)
    expect(c.payableAmount).toBe(round2(c.taxInclusiveAmount - 0.02))
  })

  it("genel iskonto ara toplamı aşamaz; ara toplam sıfırsa uygulanmaz", () => {
    const items = [{ quantity: 1, unitPrice: 100, vatRate: 20 }]
    const doc = computeDocumentTotals(items, { globalDiscountAmount: 999 })
    expect(doc.globalDiscount).toBe(100)
    expect(doc.calculation.taxExclusiveAmount).toBe(0)
    expect(doc.calculation.payableAmount).toBe(0)
    const empty = computeDocumentTotals([{ quantity: 1, unitPrice: 0, vatRate: 20 }], { globalDiscountAmount: 50 })
    expect(empty.globalDiscount).toBe(0)
  })

  it("satır iskontosu brütle kırpılır, negatif iskonto fiyatı artırmaz", () => {
    const doc = computeDocumentTotals([
      { quantity: 1, unitPrice: 100, vatRate: 20, discountAmount: 250 },
      { quantity: 1, unitPrice: 100, vatRate: 20, discountAmount: -10 },
    ])
    expect(doc.lines.map((l) => l.taxable)).toEqual([0, 100])
  })

  it("gönderim seçenekleri: sıfır tutarlı kalem elenir, kodsuz tevkifat sayılmaz", () => {
    const items = [
      { quantity: 1, unitPrice: 1000, vatRate: 20, withholdingRate: 50 },
      { quantity: 1, unitPrice: 0, vatRate: 20 },
      { quantity: 1, unitPrice: 1000, vatRate: 20, withholdingRate: 50, withholdingCode: "601" },
    ]
    const send = computeDocumentTotals(items, {}, { skipNonPositiveLines: true, withholdingNeedsCode: true })
    expect(send.lines.map((l) => l.index)).toEqual([0, 2])
    expect(send.lines.map((l) => l.withholding)).toEqual([0, 100])
    expect(send.calculation.payableAmount).toBe(round2(2400 - 100))

    // Kobipo kaydında ikisi de kapalı: eksi/sıfır satır toplamda kalır, kodsuz tevkifat düşer.
    const keep = computeDocumentTotals(items)
    expect(keep.lines).toHaveLength(3)
    expect(keep.lines.map((l) => l.withholding)).toEqual([100, 0, 100])
    expect(keep.calculation.payableAmount).toBe(round2(2400 - 200))
  })

  it("ÖTV ve maktu GEKAP KDV matrahına girer; maktu GEKAP varken oransal GEKAP susar", () => {
    const [otv] = computeDocumentTotals([{ quantity: 1, unitPrice: 100, vatRate: 20, exciseRate: 10 }]).lines
    expect(otv.excise).toBe(10)
    expect(otv.vatBase).toBe(110)
    expect(otv.rowVat).toBe(22)

    const [gekap] = computeDocumentTotals([
      { quantity: 4, unitPrice: 25, vatRate: 20, gekapUnitAmount: 0.25, otherTaxCode: "GEKAP", otherTaxRate: 5 },
    ]).lines
    expect(gekap.gekap).toBe(1)
    expect(gekap.otherTax).toBe(0)
    expect(gekap.vatBase).toBe(101)
  })
})

describe("computeInvoiceTotals — kaydedilen başlık", () => {
  it("Reypo örneği: matrah 27.059,98 · KDV 4.846,41 · ödenecek 31.906,39", () => {
    const t = computeInvoiceTotals(reypoItems, reypoAdj)
    expect(t.net).toBe(27059.98)
    expect(t.vat).toBe(4846.41)
    expect(t.total).toBe(31906.39)
    expect(t.gross).toBe(31427.97)
    expect(t.lineDiscount).toBe(2367.99)
    expect(t.subtotal).toBe(29059.98)
    expect(t.globalDiscount).toBe(2000)
    // Belgeyle aynı kaynak: ödenecek = payableAmount.
    expect(t.total).toBe(computeDocumentTotals(reypoItems, reypoAdj).calculation.payableAmount)
  })

  it("başlık, satır değerlerinin toplamıdır (Σ kuruşlu satır = kuruşlu başlık)", () => {
    const doc = computeDocumentTotals(reypoItems, reypoAdj)
    const t = computeInvoiceTotals(reypoItems, reypoAdj)
    expect(t.net).toBe(round2(doc.lines.reduce((s, l) => s + l.taxable, 0)))
    expect(t.vat).toBe(round2(doc.lines.reduce((s, l) => s + l.rowVat, 0)))
  })
})

describe("FİŞ kuralı (receipt: true) — eski yuvarlamasız toplam", () => {
  const cafeItems = [
    // KDV dahil 12,50 ₺ × 7 (KDV %10): net birim 11,363636…
    { quantity: 7, unitPrice: 12.5 / 1.1, vatRate: 10 },
    // KDV dahil 45 ₺ × 3 (KDV %10)
    { quantity: 3, unitPrice: 45 / 1.1, vatRate: 10 },
    // KDV dahil 7,90 ₺ × 1 (KDV %20)
    { quantity: 1, unitPrice: 7.9 / 1.2, vatRate: 20 },
  ]

  it("KDV dahil fiyatlı kafe fişi ekrandaki toplamı verir (87,50 + 135 + 7,90)", () => {
    const t = computeInvoiceTotals(cafeItems, {}, { receipt: true })
    expect(round2(t.total)).toBe(230.4)
    // Resmî belge kuralı aynı fişte kuruş kaydırırdı — fişin ayrı kalma sebebi.
    const official = computeInvoiceTotals(cafeItems, {})
    expect(official.total).not.toBe(230.4)
  })

  it("eski formülle (line-tax + applyGlobalAdjustment) birebir aynı", () => {
    const items = [
      { quantity: 2, unitPrice: 333.333, vatRate: 20, discountAmount: 12.345, exciseRate: 5 },
      { quantity: 3, unitPrice: 19.99, vatRate: 10, gekapUnitAmount: 0.3, withholdingRate: 20 },
      { quantity: 1, unitPrice: 100, vatRate: 20, otherTaxCode: "0059", otherTaxRate: 2 },
    ]
    const adj = { globalDiscountAmount: 40, globalChargeAmount: 5.5, payableRoundingAmount: 0.03 }

    // Eski POST ucunun formülü (git: lib/invoice/line-tax.ts tüketicileri).
    const sums = emptyLineTaxSums()
    let gross = 0
    for (const it of items) {
      const rowTotal = it.quantity * it.unitPrice
      const disc = Math.max(0, Math.min(it.discountAmount ?? 0, rowTotal))
      gross += rowTotal
      const net = rowTotal - disc
      addLineTax(sums, net, computeLineTax(net, it))
    }
    const expected = applyGlobalAdjustment(sums, sums.net - 40 + 5.5)

    const t = computeInvoiceTotals(items, adj, { receipt: true })
    expect(t.gross).toBe(gross)
    expect(t.net).toBe(expected.net)
    expect(t.vat).toBe(expected.vat)
    expect(t.vatBase).toBe(expected.vatBase)
    expect(t.excise).toBe(expected.excise)
    expect(t.otherTax).toBe(expected.otherTax)
    expect(t.gekap).toBe(expected.gekap)
    expect(t.withholding).toBe(expected.withholding)
    expect(t.total).toBe(expected.total + 0.03)
    expect(t.globalDiscount).toBe(40)
    expect(t.globalCharge).toBe(5.5)
    expect(t.rounding).toBe(0.03)
  })

  it("fişler faturaya birleşince kuruş farkı dip toplam yuvarlamasıyla kapanır", () => {
    // app/api/fisler/faturaya-donustur ile aynı kurgu: tahsil edilen = Σ fiş toplamı,
    // belge kalemlerden resmî kuralla kurulur, fark yuvarlama satırına yazılır.
    const receipts = [cafeItems.slice(0, 2), cafeItems.slice(2)]
    const collected = round2(
      receipts.reduce((s, items) => s + computeInvoiceTotals(items, {}, { receipt: true }).total, 0),
    )
    expect(collected).toBe(230.4)

    const allItems = receipts.flat()
    const document = invoiceTotalsFromStoredItems(allItems)
    const rounding = round2(collected - document.total)
    expect(rounding).not.toBe(0)

    const merged = invoiceTotalsFromStoredItems(allItems, { payableRoundingAmount: rounding })
    expect(merged.total).toBe(collected)
    // KDV'ye dokunulmaz.
    expect(merged.vat).toBe(document.vat)
    expect(merged.net).toBe(document.net)
  })
})

describe("kolon hassasiyeti ve satır iskontosu çözümü", () => {
  it("resmî belgede miktar 2, birim fiyat 6, tutar 2 ondalık; fişte olduğu gibi", () => {
    expect(documentColumnPrecision.quantity(1.23456)).toBe(1.23)
    expect(documentColumnPrecision.unitPrice(15384.6153846)).toBe(15384.615385)
    expect(documentColumnPrecision.amount(17.4999999)).toBe(17.5)
    expect(documentColumnPrecision.quantity(1.23456, true)).toBe(1.23456)
    expect(documentColumnPrecision.unitPrice(12.5 / 1.1, true)).toBe(12.5 / 1.1)
    expect(documentColumnPrecision.amount(17.4999999, true)).toBe(17.4999999)
  })

  it("resolveLineDiscount: açık mod kazanır; mod yoksa oran yok + tutar var → AMOUNT", () => {
    expect(resolveLineDiscount({ quantity: 2, unitPrice: 100, discountMode: "PERCENT", discountRate: 10 })).toBe(20)
    expect(resolveLineDiscount({ quantity: 2, unitPrice: 100, discountMode: "amount", discountAmount: 30 })).toBe(30)
    expect(resolveLineDiscount({ quantity: 2, unitPrice: 100, discountMode: "AMOUNT", discountAmount: 999 })).toBe(200)
    expect(resolveLineDiscount({ quantity: 2, unitPrice: 100, discountRate: 0, discountAmount: 30 })).toBe(30)
    // Mod kolonundan önce yazılmış kayıt: oran varsa tutar orandan türetilir.
    expect(resolveLineDiscount({ quantity: 2, unitPrice: 100, discountRate: 10, discountAmount: 30 })).toBe(20)
  })

  it("invoiceTotalsFromStoredItems: Decimal benzeri değerler ve eski AMOUNT çıkarımı", () => {
    const stored = [
      { quantity: "1", unitPrice: "12345.67", vatRate: "20", discountRate: null, discountAmount: "1000" },
      { quantity: "3", unitPrice: "4999.99", vatRate: "20", discountRate: null, discountAmount: "1250.5" },
      { quantity: "7", unitPrice: "83.333333", vatRate: "10", discountRate: "3", discountAmount: "17.5" },
      { quantity: "2", unitPrice: "1499.5", vatRate: "1", discountRate: null, discountAmount: "99.99" },
      { quantity: "1", unitPrice: "500", vatRate: "20", discountRate: null, discountAmount: null },
    ]
    const t = invoiceTotalsFromStoredItems(stored, { globalDiscountAmount: "2000" })
    expect(t.total).toBe(31906.39)
    expect(t.vat).toBe(4846.41)
  })

  it("invoiceTotalsFromStoredItems: kayıtlı iskonto tutarı orana karşı kazanır (belge o kolonu yazar)", () => {
    // 1 × 10,10 × %5 = 0,505: Postgres 0,51 yazar, JS round2 0,50 verir.
    const withAmount = invoiceTotalsFromStoredItems([
      { quantity: "1", unitPrice: "10.10", vatRate: "0", discountRate: "5", discountAmount: "0.51" },
    ])
    expect(withAmount.lineDiscount).toBe(0.51)
    expect(withAmount.net).toBe(9.59)
    // Tutar kolonu boş eski kayıt: oran devreye girer.
    const rateOnly = invoiceTotalsFromStoredItems([
      { quantity: "2", unitPrice: "100", vatRate: "0", discountRate: "10", discountAmount: null },
    ])
    expect(rateOnly.lineDiscount).toBe(20)
    // Kayıtlı tutar brütü aşamaz.
    const clipped = invoiceTotalsFromStoredItems([
      { quantity: "1", unitPrice: "100", vatRate: "0", discountRate: null, discountAmount: "150" },
    ])
    expect(clipped.net).toBe(0)
  })
})
