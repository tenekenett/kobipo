import { describe, expect, it } from "vitest"
import { convertAmount, rateOf } from "./convert"

const rates = { USD: 40, EUR: 46 }

describe("rateOf", () => {
  it("TRY her zaman 1'dir (kur alınamamış olsa bile)", () => {
    expect(rateOf(null, "TRY")).toBe(1)
    expect(rateOf(rates, "try")).toBe(1)
  })

  it("kur yoksa veya para birimi bilinmiyorsa 0 döner", () => {
    expect(rateOf(null, "USD")).toBe(0)
    expect(rateOf(rates, "GBP")).toBe(0)
    expect(rateOf({ USD: 0, EUR: 0 }, "USD")).toBe(0)
  })
})

describe("convertAmount", () => {
  it("dövizi TRY'ye çevirir", () => {
    expect(convertAmount(100, "USD", "TRY", rates)).toBe(4000)
    expect(convertAmount(100, "EUR", "TRY", rates)).toBe(4600)
  })

  it("TRY'yi dövize çevirir", () => {
    expect(convertAmount(4000, "TRY", "USD", rates)).toBe(100)
  })

  it("iki döviz arasında çapraz çevirir", () => {
    expect(convertAmount(46, "EUR", "USD", rates)).toBeCloseTo(52.9, 6)
  })

  it("aynı para biriminde tutarı olduğu gibi bırakır", () => {
    expect(convertAmount(100, "USD", "USD", rates)).toBe(100)
    expect(convertAmount(100, "", "TRY", rates)).toBe(100) // boş kod = TRY
  })

  it("KUR YOKSA null döner — 0 değil", () => {
    // 0 dönseydi tezgâh 100 $'lık ürünü bedavaya, çevirmeden dönseydi 100 ₺'ye
    // satardı. null, çağıranın "fiyatı boş bırak + uyar" diyebilmesi için şart.
    expect(convertAmount(100, "USD", "TRY", null)).toBeNull()
    expect(convertAmount(100, "USD", "TRY", { USD: 0, EUR: 46 })).toBeNull()
    expect(convertAmount(100, "GBP", "TRY", rates)).toBeNull()
  })
})
