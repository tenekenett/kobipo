import { describe, expect, it } from "vitest"
import { normalizeReceiptOkcInput } from "@/lib/okc/receipt-okc"

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
