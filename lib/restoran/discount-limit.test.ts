import { describe, expect, it } from "vitest"
import {
  amountExceedsLimit,
  discountExceedsLimit,
  isValidLimitInput,
  maxDiscountFor,
  normalizeDiscountLimit,
} from "./discount-limit"
import { ticketTotals } from "./ticket-constants"

describe("normalizeDiscountLimit", () => {
  it("tanımsız/bozuk değer sınırsız sayılır", () => {
    expect(normalizeDiscountLimit(null)).toBe(null)
    expect(normalizeDiscountLimit(undefined)).toBe(null)
    expect(normalizeDiscountLimit("")).toBe(null)
    expect(normalizeDiscountLimit("abc")).toBe(null)
  })

  it("0 sınırsız DEĞİLDİR — iskonto kapalı demektir", () => {
    expect(normalizeDiscountLimit(0)).toBe(0)
    expect(normalizeDiscountLimit("0")).toBe(0)
  })

  it("Prisma Decimal gibi nesneler Number ile çözülür", () => {
    expect(normalizeDiscountLimit({ toString: () => "50" })).toBe(50)
  })

  it("aralık dışı değer kırpılır", () => {
    expect(normalizeDiscountLimit(140)).toBe(100)
    expect(normalizeDiscountLimit(-5)).toBe(0)
  })
})

describe("isValidLimitInput", () => {
  it("sessizce sınırsıza düşmemesi için bozuk girdiyi reddeder", () => {
    expect(isValidLimitInput("abc")).toBe(false)
    expect(isValidLimitInput(101)).toBe(false)
    expect(isValidLimitInput(-1)).toBe(false)
    expect(isValidLimitInput(null)).toBe(true)
    expect(isValidLimitInput(0)).toBe(true)
    expect(isValidLimitInput(50)).toBe(true)
  })
})

describe("discountExceedsLimit", () => {
  const gross = 600

  it("tavan yoksa hiçbir iskonto aşmaz", () => {
    expect(discountExceedsLimit({ type: "PERCENT", value: 90 }, gross, null)).toBe(false)
    expect(discountExceedsLimit({ type: "AMOUNT", value: 599 }, gross, null)).toBe(false)
  })

  it("yüzde iskonto doğrudan ölçülür", () => {
    expect(discountExceedsLimit({ type: "PERCENT", value: 50 }, gross, 50)).toBe(false)
    expect(discountExceedsLimit({ type: "PERCENT", value: 50.5 }, gross, 50)).toBe(true)
  })

  it("TUTAR iskontosu da aynı tavana bağlıdır (600 ₺ hesaba 500 ₺ = %83)", () => {
    expect(discountExceedsLimit({ type: "AMOUNT", value: 500 }, gross, 50)).toBe(true)
    expect(discountExceedsLimit({ type: "AMOUNT", value: 300 }, gross, 50)).toBe(false)
  })

  it("kuruş yuvarlaması aşım sayılmaz", () => {
    expect(discountExceedsLimit({ type: "AMOUNT", value: 300.01 }, gross, 50)).toBe(false)
    expect(discountExceedsLimit({ type: "AMOUNT", value: 300.5 }, gross, 50)).toBe(true)
  })

  it("kalemsiz hesapta yüzde ölçülür, tutar ölçülemez (kapanışta yeniden bakılır)", () => {
    expect(discountExceedsLimit({ type: "PERCENT", value: 80 }, 0, 50)).toBe(true)
    expect(discountExceedsLimit({ type: "AMOUNT", value: 500 }, 0, 50)).toBe(false)
  })

  it("tavan 0 iken her iskonto reddedilir", () => {
    expect(discountExceedsLimit({ type: "PERCENT", value: 1 }, gross, 0)).toBe(true)
    expect(discountExceedsLimit({ type: "AMOUNT", value: 1 }, gross, 0)).toBe(true)
  })
})

describe("maxDiscountFor", () => {
  it("hesabın tavana denk gelen tutarını verir", () => {
    expect(maxDiscountFor(600, 50)).toBe(300)
    expect(maxDiscountFor(600, null)).toBe(null)
    expect(maxDiscountFor(0, 50)).toBe(0)
  })
})

describe("fiş ucundaki matrah ölçümü", () => {
  /**
   * Fatura ucu iskontoyu NET (matrah) olarak alır; tavan ise ekrandaki KDV dahil
   * rakama göre konulmuştur. Oranın iki tabanda da aynı çıkması bu testin konusu —
   * ayrışsalar tavan, kasiyerin gördüğünden başka bir şeyi ölçerdi.
   */
  it("net taban ile brüt taban aynı kararı verir", () => {
    const items = [{ quantity: 2, unitPrice: 250, vatRate: 20, status: "NORMAL" }]
    const totals = ticketTotals(items, { type: "PERCENT", value: 50 })

    expect(totals.gross).toBe(600)
    expect(totals.discount).toBe(300)
    expect(amountExceedsLimit(totals.discount, totals.gross, 50)).toBe(false)
    expect(amountExceedsLimit(totals.netDiscount, totals.net, 50)).toBe(false)

    const over = ticketTotals(items, { type: "AMOUNT", value: 400 })
    expect(amountExceedsLimit(over.discount, over.gross, 50)).toBe(true)
    expect(amountExceedsLimit(over.netDiscount, over.net, 50)).toBe(true)
  })
})
