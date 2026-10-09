// Dövizli faturanın caride TL karşılığı (doviz.ts) ve fatura etkisi (invoice-direction.ts).

import { describe, expect, it } from "vitest"
import { faturaKuru, tlKarsiligi } from "./doviz"
import { invoiceBalanceEffect } from "./invoice-direction"

describe("dövizli fatura cariye fatura kuruyla girer", () => {
  it("kur: TL'de 1, dövizde faturanın kuru, kursuzda 1 (borç kaybolmasın)", () => {
    expect(faturaKuru({ currency: "TRY", exchangeRate: 40 })).toBe(1)
    expect(faturaKuru({ currency: "USD", exchangeRate: "34.5" })).toBe(34.5)
    expect(faturaKuru({ currency: "EUR", exchangeRate: null })).toBe(1)
    expect(tlKarsiligi(100, { currency: "USD", exchangeRate: 34.5 })).toBe(3450)
  })

  it("100 USD satış, 30 USD bakiye kapama → müşteri 70 × 34,5 TL borçlu", () => {
    const f = {
      type: "SALES",
      returnKind: null,
      totalAmount: 100,
      currency: "USD",
      exchangeRate: 34.5,
      payments: [{ amount: 30, transactionId: null }, { amount: 50, transactionId: "t1" }],
    }
    // Kasaya bağlı ödeme (t1) faturadan düşmez: cariye hareketin TL tutarıyla ayrıca girer.
    expect(invoiceBalanceEffect("customer", [f])).toBe(70 * 34.5)
    expect(invoiceBalanceEffect("supplier", [f])).toBe(-70 * 34.5)
  })
})
