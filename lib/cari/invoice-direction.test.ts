import { describe, expect, it } from "vitest"
import {
  PURCHASE_RETURN_WHERE,
  SALES_RETURN_WHERE,
  invoiceBalanceEffect,
  isPurchaseReturn,
  isSalesReturn,
  payableSign,
  receivableSign,
} from "./invoice-direction"

const sales = { type: "SALES" }
const purchase = { type: "PURCHASE" }
const salesReturn = { type: "RETURN", returnKind: "SALES" }
const purchaseReturn = { type: "RETURN", returnKind: "PURCHASE" }
const legacyReturn = { type: "RETURN", returnKind: null }

describe("iade yönü", () => {
  it("alış iadesini yalnız returnKind=PURCHASE ile tanır", () => {
    expect(isPurchaseReturn(purchaseReturn)).toBe(true)
    expect(isPurchaseReturn(salesReturn)).toBe(false)
    expect(isPurchaseReturn(legacyReturn)).toBe(false)
    // Alış faturası, alış İADESİ değildir — yön alanı tipten bağımsız okunsaydı
    // normal alış faturası cariden ters işaretle düşerdi.
    expect(isPurchaseReturn({ type: "PURCHASE", returnKind: "PURCHASE" })).toBe(false)
  })

  it("yönü boş iade SATIŞ iadesidir (sütun öncesi belgeler)", () => {
    expect(isSalesReturn(legacyReturn)).toBe(true)
    expect(isSalesReturn({ type: "RETURN" })).toBe(true)
  })
})

describe("işaretler — iade ailesinin tersidir", () => {
  it("alacak ailesi: satış +1, satış iadesi −1, gerisi 0", () => {
    expect(receivableSign(sales)).toBe(1)
    expect(receivableSign(salesReturn)).toBe(-1)
    expect(receivableSign(legacyReturn)).toBe(-1)
    expect(receivableSign(purchase)).toBe(0)
    expect(receivableSign(purchaseReturn)).toBe(0)
  })

  it("borç ailesi: alış +1, alış iadesi −1, gerisi 0", () => {
    expect(payableSign(purchase)).toBe(1)
    expect(payableSign(purchaseReturn)).toBe(-1)
    expect(payableSign(sales)).toBe(0)
    expect(payableSign(salesReturn)).toBe(0)
  })

  it("hiçbir belge iki ailede birden sayılmaz", () => {
    // Aynı belge hem alacağa hem borca girseydi bakiye çift sayardı.
    for (const inv of [sales, purchase, salesReturn, purchaseReturn, legacyReturn]) {
      expect(receivableSign(inv) === 0 || payableSign(inv) === 0).toBe(true)
    }
  })

  it("iade, kendi ailesinde faturanın tam tersidir", () => {
    expect(receivableSign(salesReturn)).toBe(-receivableSign(sales))
    expect(payableSign(purchaseReturn)).toBe(-payableSign(purchase))
  })
})

describe("Prisma where parçaları", () => {
  it("satış iadesi filtresi NULL yönü AÇIKÇA kapsar", () => {
    // `not: "PURCHASE"` tek başına NULL satırları getirmez (SQL'de NULL <> 'X'
    // → NULL). OR düşerse sütun öncesi iadeler bakiyeden sessizce kaybolur.
    const w = SALES_RETURN_WHERE()
    expect(w.type).toBe("RETURN")
    expect(w.OR).toEqual([{ returnKind: null }, { returnKind: { not: "PURCHASE" } }])
  })

  it("her çağrı taze nesne döndürür", () => {
    expect(SALES_RETURN_WHERE()).not.toBe(SALES_RETURN_WHERE())
    expect(PURCHASE_RETURN_WHERE()).toEqual({ type: "RETURN", returnKind: "PURCHASE" })
  })
})

describe("invoiceBalanceEffect — arşiv kapısının fatura formülü", () => {
  const inv = (base: object, totalAmount: number, payments: Array<{ amount: number; transactionId?: string | null }> = []) => ({
    ...(base as { type: string }),
    totalAmount,
    payments,
  })

  it("mahsup: tedarikçi kartındaki satış, aynı tutardaki alışı kapatır (canlıda 3.231 TL)", () => {
    const faturalar = [inv(purchase, 3231), inv(sales, 3231)]
    expect(invoiceBalanceEffect("supplier", faturalar)).toBe(0)
    expect(invoiceBalanceEffect("customer", faturalar)).toBe(0)
  })

  it("müşteride satış +, satış iadesi −; tedarikçide alış +, alış iadesi −", () => {
    expect(invoiceBalanceEffect("customer", [inv(sales, 1000), inv(salesReturn, 200)])).toBe(800)
    expect(invoiceBalanceEffect("supplier", [inv(purchase, 1000), inv(purchaseReturn, 300)])).toBe(700)
  })

  it("yalnız KASAYA BAĞLANMAMIŞ ödeme düşülür — bağlı olan işlem üzerinden girer", () => {
    const f = inv(sales, 1000, [
      { amount: 300, transactionId: null },
      { amount: 500, transactionId: "trx-1" },
    ])
    expect(invoiceBalanceEffect("customer", [f])).toBe(700)
  })
})
