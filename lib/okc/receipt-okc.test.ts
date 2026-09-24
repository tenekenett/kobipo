import { describe, expect, it } from "vitest"
import { normalizeReceiptOkcInput, receiptCancelVerdict } from "@/lib/okc/receipt-okc"

describe("normalizeReceiptOkcInput", () => {
  it("cihaz + numaraları okur", () => {
    expect(normalizeReceiptOkcInput({ deviceId: "d1", receiptNo: "12", zNo: 3 })).toEqual({
      ok: true,
      data: { okcDeviceId: "d1", okcReceiptNo: 12, okcZNo: 3 },
    })
  })

  it("hepsi boşsa kimliği temizler", () => {
    expect(normalizeReceiptOkcInput({ deviceId: "", receiptNo: "", zNo: null })).toEqual({
      ok: true,
      data: { okcDeviceId: null, okcReceiptNo: null, okcZNo: null },
    })
  })

  it("numara varken cihaz zorunlu, numara pozitif tam sayı", () => {
    expect(normalizeReceiptOkcInput({ receiptNo: 5 }).ok).toBe(false)
    expect(normalizeReceiptOkcInput({ deviceId: "d1", zNo: 0 }).ok).toBe(false)
    expect(normalizeReceiptOkcInput({ deviceId: "d1", receiptNo: "1.5" }).ok).toBe(false)
  })

  it("yalnız cihaz seçmek geçerlidir (fiş o cihazdan basıldı, no bilinmiyor)", () => {
    expect(normalizeReceiptOkcInput({ deviceId: "d1" })).toEqual({
      ok: true,
      data: { okcDeviceId: "d1", okcReceiptNo: null, okcZNo: null },
    })
  })
})

describe("receiptCancelVerdict", () => {
  const base = {
    okcDeviceId: null,
    okcReceiptNo: null,
    okcZNo: null,
    okcSource: null,
    coveringZNo: null,
    confirmed: false,
  }

  it("yazarkasa bilgisi yoksa ve Z girilmemişse serbest", () => {
    expect(receiptCancelVerdict(base)).toEqual({ ok: true })
  })

  it("Z girilmişse onayla bile iptal edilmez (yazarkasa bilgisi olmasa da)", () => {
    const v = receiptCancelVerdict({ ...base, coveringZNo: 7, confirmed: true })
    expect(v.ok === false && v.code).toBe("OKC_Z_TAKEN")
    const w = receiptCancelVerdict({ ...base, okcDeviceId: "d1", okcZNo: 7, coveringZNo: 7, confirmed: true })
    expect(w.ok === false && w.code).toBe("OKC_Z_TAKEN")
  })

  it("cihazdan gelen fiş elle iptal edilmez", () => {
    const v = receiptCancelVerdict({ ...base, okcDeviceId: "d1", okcSource: "DEVICE", confirmed: true })
    expect(v.ok === false && v.code).toBe("OKC_DEVICE")
  })

  it("yazarkasa bilgili fiş onay ister, onayla geçer", () => {
    const v = receiptCancelVerdict({ ...base, okcDeviceId: "d1", okcReceiptNo: 42, okcSource: "USER" })
    expect(v.ok === false && v.code).toBe("OKC_CONFIRM")
    expect(v.ok === false && v.error).toContain("42")
    expect(receiptCancelVerdict({ ...base, okcDeviceId: "d1", okcSource: "USER", confirmed: true })).toEqual({ ok: true })
  })
})
