import { describe, expect, it } from "vitest"
import { Prisma } from "@prisma/client"
import { isForeignCurrency, roundKurus, toTryAmount } from "./incoming-amount"

/**
 * Özet kartlar tek bir ₺ rakamı gösteriyor ama tutarlar faturanın kendi para
 * biriminde saklanıyor. Kuru uygulamadan toplamak 318 USD'yi 318 ₺ sayıyordu;
 * gerçek veride tek firmada 2,7 milyon ₺ eksik toplam demekti.
 */
describe("toTryAmount", () => {
  it("dövizi kuruyla ₺ karşılığına çevirir", () => {
    const r = toTryAmount(318.2, 46.9966, "USD")
    expect(r.converted).toBe(true)
    expect(roundKurus(r.try)).toBeCloseTo(14954.32, 2)
  })

  it("TRY faturada kur 1'dir, tutar değişmez", () => {
    expect(toTryAmount(1500, 1, "TRY")).toEqual({ try: 1500, converted: true })
  })

  it("Prisma.Decimal değerlerini kabul eder (groupBy _sum bu tipte döner)", () => {
    const r = toTryAmount(new Prisma.Decimal("3000"), new Prisma.Decimal("32.99"), "CAD")
    expect(roundKurus(r.try)).toBe(98970)
    expect(r.converted).toBe(true)
  })

  it("tutar yoksa sıfır döner", () => {
    expect(toTryAmount(null, 46.99, "USD")).toEqual({ try: 0, converted: true })
    expect(toTryAmount(undefined, null, null)).toEqual({ try: 0, converted: true })
  })

  /**
   * Kritik: kuru olmayan döviz faturasını 1 kurundan toplamak, düzeltmeye
   * çalıştığımız hatanın sessiz hâli olur. Toplam DIŞINDA bırakılır ve çağıran
   * taraf bunu kullanıcıya söyler.
   */
  it("kuru olmayan DÖVİZ faturasını toplama katmaz", () => {
    expect(toTryAmount(100, null, "USD")).toEqual({ try: 0, converted: false })
    expect(toTryAmount(100, 0, "EUR")).toEqual({ try: 0, converted: false })
    expect(toTryAmount(100, -5, "EUR")).toEqual({ try: 0, converted: false })
  })

  it("kuru olmayan TRY / birimsiz faturayı 1 kabul eder", () => {
    expect(toTryAmount(100, null, "TRY")).toEqual({ try: 100, converted: true })
    expect(toTryAmount(100, null, null)).toEqual({ try: 100, converted: true })
  })
})

describe("isForeignCurrency", () => {
  it("TRY ve boş birim yerel sayılır", () => {
    expect(isForeignCurrency("TRY")).toBe(false)
    expect(isForeignCurrency("try")).toBe(false)
    expect(isForeignCurrency(null)).toBe(false)
    expect(isForeignCurrency("")).toBe(false)
  })
  it("diğerleri döviz", () => {
    expect(isForeignCurrency("USD")).toBe(true)
    expect(isForeignCurrency("EUR")).toBe(true)
  })
})

describe("roundKurus", () => {
  it("kuruşa yuvarlar", () => {
    expect(roundKurus(2357.3350000000004)).toBe(2357.34)
    expect(roundKurus(0.1 + 0.2)).toBe(0.3)
  })
})
