import { describe, expect, it } from "vitest"
import { formatMoney, money, money0, parseTrNumber, pct, qty } from "./format"
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

/**
 * Biçimlendiriciler Prisma'nın `Decimal` alanlarını METİN olarak alır
 * (`/api/stok/products` satış fiyatını "2692.5" diye yollar). Bu testler
 * 2026-08-25'te girip 2026-09-08'de fark edilen regresyonun nöbetçisidir:
 * `Number.isFinite("2692.5")` false olduğu için gerçek fiyatlar ekranda
 * ₺0,00 görünüyordu ve kullanıcı "satış fiyatları gitti" sandı.
 *
 * Ölçü tek cümle: ÖNCE ÇEVİR, SONRA SINA.
 */
describe("para/sayı biçimlendirme — Decimal metni", () => {
  it("formatMoney metin gelen fiyatı sıfırlamaz", () => {
    expect(formatMoney("2692.5")).toBe(money(2692.5))
    expect(formatMoney(2692.5)).toBe(money(2692.5))
    expect(formatMoney("141.666667")).toBe(formatMoney(141.666667))
  })

  it("formatMoney para birimini korur", () => {
    expect(formatMoney("32", "USD")).toBe(formatMoney(32, "USD"))
    expect(formatMoney("32", "USD")).not.toBe(formatMoney(32, "TRY"))
  })

  it("money/money0/qty metin girdiyi çözer", () => {
    expect(money("1234.5")).toBe(money(1234.5))
    expect(money0("1234.5")).toBe(money0(1234.5))
    expect(qty("12.3456")).toBe(qty(12.3456))
  })

  it("gerçek sıfır ile okunamayan değer aynı sonucu verir (0)", () => {
    expect(formatMoney("0")).toBe(formatMoney(0))
    expect(formatMoney("abc")).toBe(formatMoney(0))
    expect(formatMoney(null)).toBe(formatMoney(0))
  })

  it("pct metni çözer, hesaplanamayanda tire kalır", () => {
    expect(pct("80")).toBe("%80.0")
    expect(pct(80)).toBe("%80.0")
    expect(pct(null)).toBe("—")
    expect(pct("abc")).toBe("—")
  })
})
