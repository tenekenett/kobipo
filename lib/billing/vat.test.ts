import { describe, expect, it } from "vitest"
import { KOBIPO_DEFAULT_VAT_RATE, resolveVatRate, splitVatInclusive } from "./vat"

describe("resolveVatRate", () => {
  it("tanımsız/geçersiz oranda sistem varsayılanına düşer", () => {
    expect(resolveVatRate(null)).toBe(KOBIPO_DEFAULT_VAT_RATE)
    expect(resolveVatRate(undefined)).toBe(KOBIPO_DEFAULT_VAT_RATE)
    expect(resolveVatRate("abc")).toBe(KOBIPO_DEFAULT_VAT_RATE)
    expect(resolveVatRate(-5)).toBe(KOBIPO_DEFAULT_VAT_RATE)
  })

  it("paket kaydındaki oranı (Decimal → string) kabul eder", () => {
    expect(resolveVatRate("10.00")).toBe(10)
    expect(resolveVatRate(0)).toBe(0)
  })
})

describe("splitVatInclusive", () => {
  it("KDV DAHİL tutarı matrah + KDV'ye ayırır; ödenecek tutar değişmez", () => {
    const s = splitVatInclusive(10, 20)
    expect(s.net).toBe(8.33)
    expect(s.vat).toBe(1.67)
    expect(s.gross).toBe(10)
    expect(s.rounding).toBe(0)
  })

  it("mevcut paket fiyatlarının hepsinde dip toplam tahsil edilen tutara eşittir", () => {
    for (const gross of [10, 20, 30, 70, 90, 200, 249.9, 1499, 4999.99]) {
      const s = splitVatInclusive(gross, 20)
      // Belgede ödenecek tutar = net + KDV + yuvarlama. Müşteriden çekilen tutardan
      // sapmamalı — faturanın tahsilatla birebir örtüşmesi buna bağlı.
      expect(s.net + s.vat + s.rounding).toBeCloseTo(gross, 2)
    }
  })

  it("iç yüzde kuruşta tutmadığında farkı KDV'ye değil yuvarlamaya yazar", () => {
    // 10,05 / 1,20 = 8,375 → net 8,38; KDV 8,38*0,20 = 1,676 → 1,68; toplam 10,06.
    const s = splitVatInclusive(10.05, 20)
    expect(s.net).toBe(8.38)
    expect(s.vat).toBe(1.68)
    expect(s.rounding).toBe(-0.01)
    expect(s.net + s.vat + s.rounding).toBeCloseTo(10.05, 2)
  })

  it("KDV oranı 0 ise tutarın tamamı matrahtır", () => {
    const s = splitVatInclusive(100, 0)
    expect(s).toMatchObject({ net: 100, vat: 0, total: 100, rounding: 0 })
  })

  it("satır KDV'sini Mysoft ile AYNI sırayla yuvarlar", () => {
    // Provider satırda: taxableAmt = round2(net), rowVat = round2(taxable * rate/100).
    for (const gross of [10, 25.5, 70, 123.45, 999]) {
      const s = splitVatInclusive(gross, 20)
      const providerVat = Math.round(s.net * 0.2 * 100) / 100
      expect(s.vat).toBe(providerVat)
    }
  })
})
