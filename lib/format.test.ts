import { describe, expect, it } from "vitest"
import { parseTrNumber } from "./format"
import { parseAmount } from "./satis/payment"

/**
 * Sayı ayrıştırma kuralları TEK yerde (`parseTrNumber`); ödeme kutusunun
 * "negatif ve okunamayan giriş 0'dır" politikası onun ÜSTÜNDE duruyor.
 *
 * Ayrımın sebebi gelen e-fatura filtresi: orada "0" gerçek bir alt sınır, "abc"
 * ise hata. İkisini aynı sayıya indirgemek filtreyi sessizce düşürüyordu —
 * ekran "3 filtre uygulandı" derken sunucu ikisini görmezden geliyordu.
 */
describe("parseTrNumber", () => {
  it("Türkçe ondalık ve binlik ayracını çözer", () => {
    expect(parseTrNumber("12,50")).toBe(12.5)
    expect(parseTrNumber("1.500")).toBe(1500)
    expect(parseTrNumber("1.500,50")).toBe(1500.5)
    expect(parseTrNumber("1,500.50")).toBe(1500.5)
    expect(parseTrNumber("1,000,000")).toBe(1000000)
    expect(parseTrNumber("12.50")).toBe(12.5)
    expect(parseTrNumber("0.500")).toBe(0.5)
  })

  it("boşluk ve para simgesini atar", () => {
    expect(parseTrNumber(" ₺1.234,56 ")).toBe(1234.56)
    expect(parseTrNumber("1 500")).toBe(1500)
  })

  it("sayı ve negatif değerleri olduğu gibi döndürür", () => {
    expect(parseTrNumber(42)).toBe(42)
    expect(parseTrNumber(-5)).toBe(-5)
    expect(parseTrNumber("-12,5")).toBe(-12.5)
  })

  /** Asıl mesele: geçersiz girdi 0'a DÜŞMEZ, null döner. */
  it("okunamayan girdide null döner — sıfırla karıştırılmaz", () => {
    expect(parseTrNumber("sadadasdadda")).toBeNull()
    expect(parseTrNumber("")).toBeNull()
    expect(parseTrNumber("   ")).toBeNull()
    expect(parseTrNumber(",")).toBeNull()
    expect(parseTrNumber(null)).toBeNull()
    expect(parseTrNumber(undefined)).toBeNull()
    expect(parseTrNumber(NaN)).toBeNull()
    // "0" geçerli bir değerdir; null DEĞİL.
    expect(parseTrNumber("0")).toBe(0)
    expect(parseTrNumber("0,00")).toBe(0)
  })
})

describe("parseAmount (ödeme kutusu politikası)", () => {
  it("ayrıştırma kurallarını aynen korur", () => {
    expect(parseAmount("1.500,50")).toBe(1500.5)
    expect(parseAmount("1,500.50")).toBe(1500.5)
    expect(parseAmount("1.500")).toBe(1500)
    expect(parseAmount("12,50")).toBe(12.5)
    expect(parseAmount("0.500")).toBe(0.5)
    expect(parseAmount(250)).toBe(250)
  })

  it("negatif ve okunamayan girişi 0 yapar", () => {
    expect(parseAmount("-5")).toBe(0)
    expect(parseAmount(-5)).toBe(0)
    expect(parseAmount("sadadasdadda")).toBe(0)
    expect(parseAmount("")).toBe(0)
    expect(parseAmount(null)).toBe(0)
    expect(parseAmount("0")).toBe(0)
  })
})
