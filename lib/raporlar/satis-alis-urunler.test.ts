import { describe, expect, it } from "vitest"
import { aggregateProductLines, type ProductLineInput } from "./satis-alis-urunler"

const un = { id: "p-un", slug: "un", code: "UN01", name: "Un 50 kg", isService: false }

const line = (over: Partial<ProductLineInput>): ProductLineInput => ({
  invoiceId: "f1",
  date: "2026-09-01T00:00:00.000Z",
  sign: 1,
  counterpartyName: "Değirmen A.Ş.",
  product: un,
  description: "Un 50 kg",
  unit: "ÇUVAL",
  quantity: 10,
  unitPrice: 100,
  discountAmount: 0,
  vatAmount: 10,
  totalAmount: 1010,
  ...over,
})

describe("aggregateProductLines", () => {
  it("aynı kartın alışları tek satırda toplanır; ortalama ve son fiyat ayrı tutulur", () => {
    const [row] = aggregateProductLines([
      line({ invoiceId: "f1", date: "2026-09-01T00:00:00.000Z", quantity: 10, unitPrice: 100 }),
      line({
        invoiceId: "f2",
        date: "2026-09-10T00:00:00.000Z",
        quantity: 10,
        unitPrice: 120,
        counterpartyName: "Un Sanayi Ltd.",
      }),
    ])
    expect(row.quantity).toBe(20)
    expect(row.netAmount).toBe(2200)
    expect(row.avgUnitPrice).toBe(110)
    expect(row.lastUnitPrice).toBe(120)
    expect(row.lastCounterpartyName).toBe("Un Sanayi Ltd.")
    expect(row.invoiceCount).toBe(2)
    expect(row.counterpartyCount).toBe(2)
  })

  it("iade miktarı ve tutarı düşer ama 'son alış' iadeden okunmaz", () => {
    const [row] = aggregateProductLines([
      line({ invoiceId: "f1", date: "2026-09-01T00:00:00.000Z", quantity: 10, unitPrice: 100, totalAmount: 1200 }),
      line({ invoiceId: "i1", date: "2026-09-05T00:00:00.000Z", sign: -1, quantity: 2, unitPrice: 90, totalAmount: 216 }),
    ])
    expect(row.quantity).toBe(8)
    expect(row.netAmount).toBe(820)
    expect(row.totalAmount).toBe(984)
    expect(row.lastUnitPrice).toBe(100)
    expect(row.invoiceCount).toBe(2)
  })

  it("tamamı iade edilmiş üründe ortalama tanımsızdır (null), sıfıra bölünmez", () => {
    const [row] = aggregateProductLines([
      line({ invoiceId: "f1", quantity: 5 }),
      line({ invoiceId: "i1", sign: -1, quantity: 5 }),
    ])
    expect(row.quantity).toBe(0)
    expect(row.avgUnitPrice).toBeNull()
  })

  it("satır iskontosu net tutardan düşer", () => {
    const [row] = aggregateProductLines([line({ quantity: 3, unitPrice: 33.335, discountAmount: 10 })])
    // 3 × 33,335 = 100,005 → kuruşa 100,01; − 10 iskonto
    expect(row.netAmount).toBe(90.01)
  })

  it("serbest kalem ad + birimle, Türkçe duyarsız gruplanır", () => {
    const rows = aggregateProductLines([
      line({ product: null, description: "Nakliye", unit: "ADET", invoiceId: "f1" }),
      line({ product: null, description: "NAKLİYE ", unit: "adet", invoiceId: "f2" }),
      line({ product: null, description: "Nakliye", unit: "SAAT", invoiceId: "f3" }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.kind === "Serbest kalem" && r.productRef === null)).toBe(true)
    expect(rows.find((r) => r.invoiceCount === 2)).toBeDefined()
  })

  it("tutara göre azalan sıralanır", () => {
    const rows = aggregateProductLines([
      line({ product: { ...un, id: "a", name: "A" }, totalAmount: 100 }),
      line({ product: { ...un, id: "b", name: "B" }, totalAmount: 900 }),
    ])
    expect(rows.map((r) => r.name)).toEqual(["B", "A"])
  })
})
