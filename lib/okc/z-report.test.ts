import { describe, expect, it } from "vitest"
import { normalizeZInput, parseStoredPaymentLines, vatTolerance, zInternalChecks } from "@/lib/okc/z-report"
import { normalizeDeviceCode, normalizeDeviceInput } from "@/lib/okc/devices"

const base = {
  deviceId: "dev1",
  zNo: 42,
  // Geçmişte sabit: "gelecek tarihli Z" kuralı Date.now()'a bakıyor.
  takenAt: "2026-09-20T23:00:00+03:00",
  grossTotal: "1.234,56",
}

describe("normalizeZInput", () => {
  it("TR biçimli tutarı okur, boş satırları atar", () => {
    const r = normalizeZInput({
      ...base,
      vatLines: [
        { rate: 1, base: "", vat: "" },
        { rate: 10, base: "1.122,33", vat: "112,23" },
      ],
      paymentLines: [
        { method: "CASH", amount: "1.234,56" },
        { method: "CREDIT_CARD", amount: "0" },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.grossTotal).toBe(1234.56)
    expect(r.data.vatLines).toEqual([{ rate: 10, base: 1122.33, vat: 112.23 }])
    expect(r.data.paymentLines).toEqual([{ method: "CASH", amount: 1234.56 }])
  })

  it("zorunlu alanları ve geçersiz değerleri reddeder", () => {
    expect(normalizeZInput({ ...base, deviceId: "" }).ok).toBe(false)
    expect(normalizeZInput({ ...base, zNo: 0 }).ok).toBe(false)
    expect(normalizeZInput({ ...base, zNo: "12a" }).ok).toBe(false)
    expect(normalizeZInput({ ...base, takenAt: "dün" }).ok).toBe(false)
    expect(normalizeZInput({ ...base, grossTotal: "" }).ok).toBe(false)
    expect(normalizeZInput({ ...base, receiptCount: 1.5 }).ok).toBe(false)
    expect(normalizeZInput({ ...base, paymentLines: [{ method: "BITCOIN", amount: 5 }] }).ok).toBe(false)
  })

  it("KDV satırı Z'deki gibi KDV DAHİL toplamla girilir; matrah türetilir, %0 kabul", () => {
    const r = normalizeZInput({
      ...base,
      vatLines: [
        { rate: 0, gross: "6.000,00", vat: "" },
        { rate: 10, gross: "700,00", vat: "63,64" },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.vatLines).toEqual([
      { rate: 0, base: 6000, vat: 0 },
      { rate: 10, base: 636.36, vat: 63.64 },
    ])
  })

  it("KDV, KDV dahil toplamdan büyük olamaz", () => {
    const r = normalizeZInput({ ...base, vatLines: [{ rate: 10, gross: "50", vat: "63,64" }] })
    expect(r.ok).toBe(false)
  })

  it("karekod ödeme tiplerini kabul eder", () => {
    const r = normalizeZInput({
      ...base,
      paymentLines: [
        { method: "QR_CARD", amount: "1.150" },
        { method: "QR_FAST", amount: "50" },
      ],
    })
    expect(r.ok && r.data.paymentLines.map((l) => l.method)).toEqual(["QR_CARD", "QR_FAST"])
  })

  it("gelecek tarihli Z'yi reddeder", () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    expect(normalizeZInput({ ...base, takenAt: future }).ok).toBe(false)
  })

  it("aynı oran ya da ödeme tipi iki kez girilemez", () => {
    expect(
      normalizeZInput({
        ...base,
        vatLines: [
          { rate: 10, base: 1, vat: 0.1 },
          { rate: 10, base: 2, vat: 0.2 },
        ],
      }).ok,
    ).toBe(false)
    expect(
      normalizeZInput({
        ...base,
        paymentLines: [
          { method: "CASH", amount: 1 },
          { method: "CASH", amount: 2 },
        ],
      }).ok,
    ).toBe(false)
  })
})

describe("zInternalChecks", () => {
  it("tutarlı Z'de uyarı yok", () => {
    expect(
      zInternalChecks({
        grossTotal: 230,
        vatLines: [
          { rate: 10, base: 100, vat: 10 },
          { rate: 20, base: 100, vat: 20 },
        ],
        paymentLines: [{ method: "CASH", amount: 230 }],
      }),
    ).toEqual([])
  })

  it("yazım hatasını yakalar: toplamlar ve oran", () => {
    const issues = zInternalChecks({
      grossTotal: 320,
      vatLines: [{ rate: 10, base: 100, vat: 12 }],
      paymentLines: [{ method: "CASH", amount: 230 }],
    })
    expect(issues.map((i) => i.code).sort()).toEqual(["PAYMENT_SUM", "VAT_RATE", "VAT_SUM"])
  })

  // iDE280 Z'sinin yapısı (2026-09, rakamlar örnek): cihaz KDV'yi fiş fiş yuvarlayıp
  // topladığı için %1 grubunda KDV toplamdan hesaplanandan 3 kuruş sapıyor.
  const gercekZ = {
    grossTotal: 11700,
    vatLines: [
      { rate: 0, base: 6000, vat: 0 },
      { rate: 1, base: 5000 - 49.47, vat: 49.47 }, // toplamdan hesap 49,50
      { rate: 10, base: 636.36, vat: 63.64 },
    ],
    paymentLines: [
      { method: "CASH" as const, amount: 2000 },
      { method: "CREDIT_CARD" as const, amount: 8500 },
      { method: "QR_CARD" as const, amount: 1150 },
      { method: "QR_FAST" as const, amount: 50 },
    ],
  }

  it("gerçek Z'nin fiş fiş yuvarlama sapması uyarı üretmez", () => {
    expect(zInternalChecks({ ...gercekZ, receiptCount: 50 })).toEqual([])
    expect(zInternalChecks({ ...gercekZ, receiptCount: null })).toEqual([])
  })

  it("aynı Z'de KDV yazım hatası yine yakalanır", () => {
    const vatLines = gercekZ.vatLines.map((l) => (l.rate === 1 ? { ...l, base: 5000 - 94.47, vat: 94.47 } : l))
    const issues = zInternalChecks({ ...gercekZ, vatLines, receiptCount: 50 })
    expect(issues.map((i) => i.code)).toEqual(["VAT_RATE"])
  })

  it("KDV payı fiş başına yarım kuruş, en az 2 kuruş", () => {
    expect(vatTolerance(49.47, 50)).toBeCloseTo(0.25, 6)
    expect(vatTolerance(49.47, 1)).toBe(0.02)
    expect(vatTolerance(49.47, null)).toBeCloseTo(0.4947, 6)
  })

  it("girilmeyen eksen sorulmaz", () => {
    expect(zInternalChecks({ grossTotal: 100, vatLines: [], paymentLines: [] })).toEqual([])
  })
})

describe("parseStoredPaymentLines", () => {
  it("bozuk kaydı düşürmeden eler", () => {
    expect(
      parseStoredPaymentLines([{ method: "CASH", amount: "5" }, { method: "QR_FAST", amount: 2 }, { method: "X", amount: 1 }, null]),
    ).toEqual([
      { method: "CASH", amount: 5 },
      { method: "QR_FAST", amount: 2 },
    ])
    expect(parseStoredPaymentLines("bozuk")).toEqual([])
  })
})

describe("normalizeDeviceInput", () => {
  it("seri ve EKÜ no'yu boşluksuz büyük harfe çevirir", () => {
    expect(normalizeDeviceCode(" jh 2001 2345 ")).toBe("JH20012345")
    const r = normalizeDeviceInput({ name: " Kasa 1 ", serialNo: "bk 01", ekuNo: "ek 9", brand: "Beko" })
    expect(r).toEqual({
      ok: true,
      data: { name: "Kasa 1", serialNo: "BK01", ekuNo: "EK9", brand: "Beko", model: null },
    })
  })

  it("oluştururken ad ve seri no zorunlu; PATCH'te yalnız gelen alan döner", () => {
    expect(normalizeDeviceInput({ serialNo: "X1" }).ok).toBe(false)
    expect(normalizeDeviceInput({ name: "Kasa" }).ok).toBe(false)
    expect(normalizeDeviceInput({ ekuNo: "" }, { partial: true })).toEqual({ ok: true, data: { ekuNo: null } })
  })

  it("seri noda geçersiz karakteri reddeder", () => {
    expect(normalizeDeviceInput({ name: "Kasa", serialNo: "AB#12" }).ok).toBe(false)
  })
})
