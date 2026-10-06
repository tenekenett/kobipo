import { describe, expect, it } from "vitest"
import { applyTicketDiscount, ticketDiscountLabel } from "./ticket-discount"

// 2 × 100 TL + %20 KDV → net 200, toplam 240.
const T = { net: 200, total: 240 }

describe("applyTicketDiscount — fiş altı iskonto", () => {
  it("tutar iskontosu KDV dahil girilir, matraha oranla çevrilir", () => {
    expect(applyTicketDiscount(T, "AMOUNT", 24)).toEqual({ gross: 24, net: 20, total: 216 })
  })

  it("yüzde iskonto", () => {
    expect(applyTicketDiscount(T, "PERCENT", 10)).toEqual({ gross: 24, net: 20, total: 216 })
  })

  it("tutar toplamı aşamaz, yüzde 100'ü aşamaz", () => {
    expect(applyTicketDiscount(T, "AMOUNT", 1000)).toEqual({ gross: 240, net: 200, total: 0 })
    expect(applyTicketDiscount(T, "PERCENT", 150)).toEqual({ gross: 240, net: 200, total: 0 })
  })

  it("boş/negatif iskonto toplamı değiştirmez", () => {
    expect(applyTicketDiscount(T, "AMOUNT", 0)).toEqual({ gross: 0, net: 0, total: 240 })
    expect(applyTicketDiscount(T, "PERCENT", -5)).toEqual({ gross: 0, net: 0, total: 240 })
  })

  it("karışık KDV'de net iskonto sepetin net/brüt oranıyla", () => {
    // 100 net %20 + 100 net %10 → net 200, toplam 230; 23 TL iskonto = %10.
    const r = applyTicketDiscount({ net: 200, total: 230 }, "AMOUNT", 23)
    expect(r).toEqual({ gross: 23, net: 20, total: 207 })
  })

  it("etiket", () => {
    expect(ticketDiscountLabel("PERCENT", 12.5)).toBe("İskonto %12,5")
    expect(ticketDiscountLabel("AMOUNT", 50)).toBe("İskonto")
  })
})
