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
import { parseDiscountCodeInput } from "./discount-input"
import { isFreeAmount } from "./free-order"

/** Formun `<input type="date">` alanının ürettiği gövde. */
function body(over: Record<string, unknown> = {}) {
  return { type: "PERCENT", value: 20, scope: "ALL", ...over }
}

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

describe("kampanya penceresi — tarih-only girdinin saat dilimi", () => {
  // Panelin tarih alanı "YYYY-MM-DD" verir; `new Date()` bunu UTC gece yarısı sayardı.
  // Türkiye UTC+3 olduğu için "28 Ağustos'a kadar geçerli" denen kupon 28 Ağustos
  // 03:00'te ölüyordu — o günün tamamı kaybediliyordu. Canlıda tam olarak bu oldu.
  it("bitiş, Türkiye gününün SON anına sabitlenir", () => {
    const r = parseDiscountCodeInput(body({ endsAt: "2026-08-28" }), { requireAll: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 28.08 23:59:59.999 TR = 28.08 20:59:59.999 UTC
    expect(r.data.endsAt?.toISOString()).toBe("2026-08-28T20:59:59.999Z")

    // O günün öğleni HÂLÂ pencerenin içinde olmalı.
    const ogleTR = new Date("2026-08-28T09:00:00.000Z")
    expect(ogleTR > (r.data.endsAt as Date)).toBe(false)
  })

  it("başlangıç, Türkiye gününün İLK anına sabitlenir", () => {
    const r = parseDiscountCodeInput(body({ startsAt: "2026-08-26" }), { requireAll: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 26.08 00:00 TR = 25.08 21:00 UTC
    expect(r.data.startsAt?.toISOString()).toBe("2026-08-25T21:00:00.000Z")
  })

  it("tek günlük kampanya sıfır uzunlukta kalmaz", () => {
    // Aynı gün başlayıp biten kupon: UTC gece yarısı okumasıyla startsAt === endsAt
    // olurdu ve kod hiçbir an geçerli olmazdı.
    const r = parseDiscountCodeInput(
      body({ startsAt: "2026-09-01", endsAt: "2026-09-01" }),
      { requireAll: true },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const span = (r.data.endsAt as Date).getTime() - (r.data.startsAt as Date).getTime()
    expect(span).toBe(24 * 60 * 60 * 1000 - 1)
  })

  it("saat içeren tam zaman damgasına dokunmaz", () => {
    const r = parseDiscountCodeInput(
      body({ endsAt: "2026-08-28T12:30:00.000Z" }), { requireAll: true },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.endsAt?.toISOString()).toBe("2026-08-28T12:30:00.000Z")
  })

  it("bitiş başlangıçtan önce olamaz kuralı korunur", () => {
    const r = parseDiscountCodeInput(
      body({ startsAt: "2026-09-10", endsAt: "2026-09-01" }), { requireAll: true },
    )
    expect(r.ok).toBe(false)
  })
})

describe("tam bedava kupon", () => {
  // Panel %100'e izin veriyor; değerlendirme ise "tutarın tamamını karşılıyor" diye
  // reddediyordu. Admin kuponu kuruyor, kodu giren her müşteri hata alıyordu.
  it("panel %100'ü kabul eder, %101'i reddeder", () => {
    expect(parseDiscountCodeInput(body({ value: 100 }), { requireAll: true }).ok).toBe(true)
    expect(parseDiscountCodeInput(body({ value: 101 }), { requireAll: true }).ok).toBe(false)
  })

  it("%100 indirim tutarın tamamıdır — tahsil edilecek 0 kalır", () => {
    const list = 1500
    const amount = computeDiscountAmount({ type: "PERCENT", value: 100 }, list)
    expect(amount).toBe(1500)
    expect(list - amount).toBe(0)
  })

  it("sabit tutar fiyatı aşsa da tahsilat negatife düşmez", () => {
    const list = 375
    const amount = computeDiscountAmount({ type: "AMOUNT", value: 500 }, list)
    expect(list - amount).toBe(0)
  })

  it("ücretsiz sipariş eşiği kuruş artığına takılmaz", () => {
    expect(isFreeAmount(0)).toBe(true)
    expect(isFreeAmount("0.00")).toBe(true)
    expect(isFreeAmount(0.01)).toBe(false)
    expect(isFreeAmount(1500)).toBe(false)
  })
})
