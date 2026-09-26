import { describe, expect, it } from "vitest"
import { normalizeCurrency, sumByCurrency } from "./list-query"

describe("sumByCurrency", () => {
  it("farklı dövizleri kur çevirmeden ayrı toplar, TRY önce", () => {
    const t = sumByCurrency([
      { currency: "EUR", totalAmount: 1100 },
      { currency: "USD", totalAmount: 1080 },
      { currency: "TRY", totalAmount: 100 },
      { currency: null, totalAmount: 200 },
    ])
    expect(t.count).toBe(4)
    expect(t.sums).toEqual([
      { currency: "TRY", amount: 300 },
      { currency: "EUR", amount: 1100 },
      { currency: "USD", amount: 1080 },
    ])
  })

  it("boş listede toplam yok, tutarsız satır 0 sayılır", () => {
    expect(sumByCurrency([])).toEqual({ count: 0, sums: [] })
    expect(sumByCurrency([{ currency: "usd", totalAmount: null }]).sums).toEqual([{ currency: "USD", amount: 0 }])
  })

  it("kuruş kayması olmadan yuvarlar", () => {
    expect(sumByCurrency([{ currency: "TRY", totalAmount: 0.1 }, { currency: "TRY", totalAmount: 0.2 }]).sums[0].amount).toBe(0.3)
  })

  it("TL ve boş kod TRY sayılır", () => {
    expect(normalizeCurrency("TL")).toBe("TRY")
    expect(normalizeCurrency(" ")).toBe("TRY")
    expect(normalizeCurrency("gbp")).toBe("GBP")
  })
})
