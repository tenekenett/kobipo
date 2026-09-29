import { describe, expect, it } from "vitest"
import { defaultLineUnitPrice, priceSideFor } from "./line-default-price"

describe("priceSideFor", () => {
  it("alış faturası ve alış iadesi ALIŞ tarafıdır", () => {
    expect(priceSideFor("PURCHASE")).toBe("purchase")
    expect(priceSideFor("RETURN", "PURCHASE")).toBe("purchase")
  })
  it("satış, satış iadesi ve yönsüz eski iade SATIŞ tarafıdır", () => {
    expect(priceSideFor("SALES")).toBe("sale")
    expect(priceSideFor("RETURN", "SALES")).toBe("sale")
    expect(priceSideFor("RETURN", null)).toBe("sale")
  })
})

describe("defaultLineUnitPrice", () => {
  const urun = { salePrice: 400, purchasePrice: 250, avgPurchasePrice: 240 }

  it("alışta kart alış fiyatı, satışta satış fiyatı", () => {
    expect(defaultLineUnitPrice(urun, "purchase")).toBe(250)
    expect(defaultLineUnitPrice(urun, "sale")).toBe(400)
  })

  it("alışta kart fiyatı yoksa ortalama maliyet", () => {
    expect(defaultLineUnitPrice({ ...urun, purchasePrice: null }, "purchase")).toBe(240)
    expect(defaultLineUnitPrice({ ...urun, purchasePrice: 0 }, "purchase")).toBe(240)
  })

  it("alışta hiçbiri yoksa 0 — satış fiyatına ASLA düşülmez", () => {
    expect(defaultLineUnitPrice({ salePrice: 400, purchasePrice: null, avgPurchasePrice: null }, "purchase")).toBe(0)
  })

  it("Decimal/metin gelen fiyatı sayıya çevirir", () => {
    expect(defaultLineUnitPrice({ purchasePrice: "199.90" }, "purchase")).toBe(199.9)
    expect(defaultLineUnitPrice({ salePrice: "" }, "sale")).toBe(0)
  })
})
