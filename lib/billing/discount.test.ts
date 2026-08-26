/**
 * İndirim tutarı hesabının testleri.
 *
 * Bu hesap iki yerde birden görünür: "kodu uygula" kutusundaki ön izleme ve siparişin
 * gerçek tutarı. İkisi tek fonksiyondan geldiği için burada kilitlenen kural, ekranda
 * yazan indirim ile tahsil edilen tutarın ayrışmamasıdır. İki sınır (sabit indirimin
 * sipariş tutarını aşamaması, kuruş yuvarlaması) sessizce kaybolursa müşteriden
 * yanlış tutar çekilir — testler onları tutar.
 */

import { describe, expect, it } from "vitest"
import { computeDiscountAmount } from "./discount"
import { normalizeDiscountCode } from "./discount-code"

describe("normalizeDiscountCode", () => {
  it("boşlukları atar ve büyük harfe çevirir", () => {
    expect(normalizeDiscountCode(" yaz 25 ")).toBe("YAZ25")
  })

  it("Türkçe büyütme tuzağına düşmez: 'min1000' → 'MIN1000' (İ değil I)", () => {
    // toLocaleUpperCase("tr-TR") burada "MİN1000" üretir ve panelde ASCII yazılmış
    // kodu BULAMAZ. Kupon sessizce çalışmaz; çevrim yerel-bağımsız olmalı.
    expect(normalizeDiscountCode("min1000")).toBe("MIN1000")
    expect(normalizeDiscountCode("indirim")).toBe("INDIRIM")
  })

  it("Türkçe harfleri ASCII karşılığına indirger", () => {
    expect(normalizeDiscountCode("kış-şölen")).toBe("KIS-SOLEN")
    expect(normalizeDiscountCode("İNDİRİM")).toBe("INDIRIM")
  })

  it("boş/eksik girdide boş dize döner", () => {
    expect(normalizeDiscountCode(null)).toBe("")
    expect(normalizeDiscountCode(undefined)).toBe("")
  })
})

describe("computeDiscountAmount", () => {
  it("yüzde indirimi kuruşa yuvarlayarak hesaplar", () => {
    expect(computeDiscountAmount({ type: "PERCENT", value: 10 }, 375)).toBe(37.5)
    // 333,33'ün %15'i = 49,9995 → 50,00 (yarım kuruş tahsil edilemez)
    expect(computeDiscountAmount({ type: "PERCENT", value: 15 }, 333.33)).toBe(50)
  })

  it("sabit tutarı olduğu gibi uygular", () => {
    expect(computeDiscountAmount({ type: "AMOUNT", value: 100 }, 375)).toBe(100)
  })

  it("sabit tutar sipariş tutarını aşamaz — bedava satış yapılmaz", () => {
    expect(computeDiscountAmount({ type: "AMOUNT", value: 500 }, 375)).toBe(375)
  })

  it("tutar yoksa indirim de yoktur", () => {
    expect(computeDiscountAmount({ type: "PERCENT", value: 10 }, 0)).toBe(0)
    expect(computeDiscountAmount({ type: "AMOUNT", value: 10 }, -5)).toBe(0)
  })
})
