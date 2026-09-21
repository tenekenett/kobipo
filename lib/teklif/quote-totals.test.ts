import { describe, expect, it } from "vitest"
import {
  calcQuoteLineTotals,
  calcQuoteTotals,
  globalDiscountFromRecord,
  isSectionLine,
  resolveDiscountMode,
} from "@/lib/teklif/quote-totals"
import { buildQuoteRecord } from "@/lib/teklif/quote-record"

describe("teklif satır iskontosu", () => {
  it("yüzde: brütün oranı kadar düşer", () => {
    const c = calcQuoteLineTotals({ quantity: 2, unitPrice: 500, vatRate: 20, discountMode: "PERCENT", discountRate: 10 })
    expect(c.gross).toBe(1000)
    expect(c.discount).toBe(100)
    expect(c.net).toBe(900)
    expect(c.vat).toBeCloseTo(180)
    expect(c.total).toBeCloseTo(1080)
    expect(c.discountRate).toBe(10)
  })

  it("tutar: SATIR toplamından düşer (birim başı değil), oran null yazılır", () => {
    const c = calcQuoteLineTotals({ quantity: 3, unitPrice: 100, vatRate: 20, discountMode: "AMOUNT", discountAmount: 50 })
    expect(c.discount).toBe(50)
    expect(c.net).toBe(250)
    expect(c.discountRate).toBeNull()
  })

  it("tutar brütü aşamaz, oran 100'ü aşamaz, negatif iskonto fiyatı artırmaz", () => {
    expect(calcQuoteLineTotals({ quantity: 1, unitPrice: 100, vatRate: 0, discountMode: "AMOUNT", discountAmount: 250 }).net).toBe(0)
    expect(calcQuoteLineTotals({ quantity: 1, unitPrice: 100, vatRate: 0, discountMode: "PERCENT", discountRate: 150 }).net).toBe(0)
    expect(calcQuoteLineTotals({ quantity: 1, unitPrice: 100, vatRate: 0, discountMode: "PERCENT", discountRate: -10 }).net).toBe(100)
    expect(calcQuoteLineTotals({ quantity: 1, unitPrice: 100, vatRate: 0, discountMode: "AMOUNT", discountAmount: -10 }).net).toBe(100)
  })

  it("mod yoksa eski kayıt kuralı: oran yok + tutar var → AMOUNT", () => {
    expect(resolveDiscountMode(null, null, 40)).toBe("AMOUNT")
    expect(resolveDiscountMode(undefined, 0, 40)).toBe("AMOUNT")
    // Mod kolonundan önceki teklifler oranla yazılıyor ve tutar oradan türetiliyordu.
    expect(resolveDiscountMode(undefined, 10, 40)).toBe("PERCENT")
    expect(resolveDiscountMode(undefined, 0, 0)).toBe("PERCENT")
    expect(resolveDiscountMode("amount", 10, 0)).toBe("AMOUNT")
  })
})

describe("teklif genel iskontosu", () => {
  const lines = [
    { quantity: 1, unitPrice: 1000, vatRate: 20, discountMode: "PERCENT", discountRate: 10 }, // net 900, KDV 180
    { quantity: 2, unitPrice: 250, vatRate: 10, discountMode: "AMOUNT", discountAmount: 100 }, // net 400, KDV 40
  ]

  it("iskonto yoksa toplamlar satırların toplamıdır", () => {
    const t = calcQuoteTotals(lines, null)
    expect(t.gross).toBe(1500)
    expect(t.lineDiscount).toBe(200)
    expect(t.subtotal).toBe(1300)
    expect(t.globalDiscount).toBe(0)
    expect(t.net).toBe(1300)
    expect(t.vat).toBeCloseTo(220)
    expect(t.total).toBeCloseTo(1520)
  })

  it("yüzde: ara toplamın oranı; KDV aynı katsayıyla düşer", () => {
    const t = calcQuoteTotals(lines, { mode: "PERCENT", value: 10 })
    expect(t.globalDiscount).toBe(130)
    expect(t.globalDiscountRate).toBe(10)
    expect(t.net).toBeCloseTo(1170)
    expect(t.vat).toBeCloseTo(198) // 220 × 0,9
    expect(t.total).toBeCloseTo(1368)
  })

  it("tutar: ara toplamı aşamaz, oran null yazılır", () => {
    const t = calcQuoteTotals(lines, { mode: "AMOUNT", value: 5000 })
    expect(t.globalDiscount).toBe(1300)
    expect(t.globalDiscountRate).toBeNull()
    expect(t.net).toBe(0)
    expect(t.total).toBeCloseTo(0)
  })

  it("yüzde iskonto kuruşa yuvarlanır ve net o yuvarlı tutardan hesaplanır", () => {
    const t = calcQuoteTotals([{ quantity: 1, unitPrice: 333.33, vatRate: 0 }], { mode: "PERCENT", value: 12.5 })
    expect(t.globalDiscount).toBe(41.67) // 41,66625
    expect(t.net).toBeCloseTo(291.66, 10)
  })

  it("toplam kuruşa yuvarlı matrah + KDV'dir (belge kendi içinde tutar)", () => {
    // Reypo ölçümü: ayrı yuvarlanınca 26.378,01 + 4.713,76 ≠ 31.091,78 çıkıyordu.
    const t = calcQuoteTotals(
      [
        { quantity: 1, unitPrice: 12345.67, vatRate: 20, discountMode: "PERCENT", discountRate: 12.5 },
        { quantity: 3, unitPrice: 4999.99, vatRate: 20, discountMode: "AMOUNT", discountAmount: 1250.5 },
        { quantity: 7, unitPrice: 83.333333, vatRate: 10, discountMode: "PERCENT", discountRate: 3 },
        { quantity: 2, unitPrice: 1499.5, vatRate: 1, discountMode: "AMOUNT", discountAmount: 99.99 },
        { quantity: 1, unitPrice: 500, vatRate: 20 },
      ],
      { mode: "PERCENT", value: 7.5 },
    )
    expect(t.globalDiscount).toBe(2138.76)
    expect(t.net).toBe(26378.01)
    expect(t.vat).toBe(4713.76)
    expect(t.total).toBe(31091.77) // Mysoft taslak UBL PayableAmount ile aynı
  })

  it("boş/sıfır değer iskonto sayılmaz", () => {
    expect(calcQuoteTotals(lines, { mode: "AMOUNT", value: "" }).globalDiscount).toBe(0)
    expect(calcQuoteTotals(lines, { mode: "PERCENT", value: "0" }).globalDiscountRate).toBeNull()
  })

  it("kayıttan mod/değer geri kurulur: oran varsa yüzde, yoksa tutar", () => {
    expect(globalDiscountFromRecord({ globalDiscountRate: "10.00", globalDiscountAmount: "130.00" })).toEqual({ mode: "PERCENT", value: 10 })
    expect(globalDiscountFromRecord({ globalDiscountRate: null, globalDiscountAmount: "75.5" })).toEqual({ mode: "AMOUNT", value: 75.5 })
    expect(globalDiscountFromRecord({ globalDiscountRate: null, globalDiscountAmount: null })).toBeNull()
  })
})

describe("teklif bölüm ayırıcısı", () => {
  const priced = [
    { quantity: 1, unitPrice: 1000, vatRate: 20, discountMode: "PERCENT", discountRate: 10 }, // net 900
    { quantity: 2, unitPrice: 250, vatRate: 10, discountMode: "AMOUNT", discountAmount: 100 }, // net 400
  ]

  it("kolon yoksa/boşsa satır fiyatlı kalemdir", () => {
    expect(isSectionLine("SECTION")).toBe(true)
    expect(isSectionLine("section")).toBe(true)
    expect(isSectionLine("ITEM")).toBe(false)
    expect(isSectionLine(null)).toBe(false)
    expect(isSectionLine(undefined)).toBe(false)
    expect(isSectionLine("")).toBe(false)
  })

  it("bölüm satırı toplamı DEĞİŞTİRMEZ (araya girse de sona düşse de)", () => {
    const wanted = calcQuoteTotals(priced, { mode: "PERCENT", value: 10 })
    const withSections = calcQuoteTotals(
      [
        { kind: "SECTION", quantity: 0, unitPrice: 0, vatRate: 0 },
        priced[0],
        { kind: "SECTION", quantity: 0, unitPrice: 0, vatRate: 0 },
        priced[1],
        { kind: "SECTION", quantity: 0, unitPrice: 0, vatRate: 0 },
      ],
      { mode: "PERCENT", value: 10 },
    )
    expect(withSections.gross).toBe(wanted.gross)
    expect(withSections.lineDiscount).toBe(wanted.lineDiscount)
    expect(withSections.globalDiscount).toBe(wanted.globalDiscount)
    expect(withSections.net).toBe(wanted.net)
    expect(withSections.vat).toBe(wanted.vat)
    expect(withSections.total).toBe(wanted.total)
  })

  it("SON satır bölümse genel iskontonun kuruş artığı kaybolmaz", () => {
    // Artık son satıra yazılır; bölüm belgeye SIFIR satır olarak geçseydi o
    // kuruş sıfır satıra düşer ve matrahtan eksilirdi.
    const lines = [
      { quantity: 1, unitPrice: 333.33, vatRate: 20 },
      { quantity: 1, unitPrice: 666.67, vatRate: 20 },
    ]
    const wanted = calcQuoteTotals(lines, { mode: "PERCENT", value: 7.5 })
    const trailing = calcQuoteTotals([...lines, { kind: "SECTION", quantity: 0, unitPrice: 0, vatRate: 0 }], {
      mode: "PERCENT",
      value: 7.5,
    })
    expect(trailing.net).toBe(wanted.net)
    expect(trailing.total).toBe(wanted.total)
  })

  it("bölümde kalan fiyat değerleri sızmaz: satır sıfır sayılır", () => {
    const c = calcQuoteLineTotals({ kind: "SECTION", quantity: 5, unitPrice: 100, vatRate: 20, discountRate: 10 })
    expect(c.gross).toBe(0)
    expect(c.net).toBe(0)
    expect(c.vat).toBe(0)
    expect(c.total).toBe(0)
    expect(c.discountRate).toBeNull()
  })
})

describe("teklif kaydı: bölüm satırı", () => {
  it("bölüm fiyat kolonlarını sıfır/boş yazar, kalem sayısına girmez", () => {
    const record = buildQuoteRecord(
      [
        { kind: "SECTION", description: "Mutfak", note: "Zemin kattaki üretim alanı", quantity: 5, unitPrice: 100, vatRate: 20, productId: "p1" },
        { description: "Davlumbaz", quantity: 2, unitPrice: 1000, vatRate: 20 },
      ],
      null,
    )
    expect(record.itemCount).toBe(1)
    expect(record.normalized[0]).toMatchObject({
      kind: "SECTION",
      description: "Mutfak",
      note: "Zemin kattaki üretim alanı",
      productId: null,
      quantity: 0,
      unitPrice: 0,
      vatRate: 0,
      vatAmount: 0,
      totalAmount: 0,
      discountRate: null,
      discountAmount: 0,
    })
    expect(record.netAmount).toBe(2000)
    expect(record.totalAmount).toBe(2400)
  })

  it("başlıksız ama açıklamalı bölüm kayda girer; tamamen boşu düşer", () => {
    const record = buildQuoteRecord(
      [
        { kind: "SECTION", description: "  ", note: "Fiyatlara montaj dahildir" },
        { kind: "SECTION", description: "", note: "" },
        { description: "Davlumbaz", quantity: 1, unitPrice: 100, vatRate: 0 },
        { description: "   " },
      ],
      null,
    )
    expect(record.normalized).toHaveLength(2)
    expect(record.normalized[0]).toMatchObject({ kind: "SECTION", description: "", note: "Fiyatlara montaj dahildir" })
    expect(record.itemCount).toBe(1)
  })
})
