import { describe, expect, it } from "vitest"
import { invoiceStatusLabel } from "./status-label"

describe("invoiceStatusLabel", () => {
  it("ham kodları Türkçeye çevirir", () => {
    expect(invoiceStatusLabel("GIB_DRAFT")).toBe("GİB Taslağı")
    expect(invoiceStatusLabel("SENT")).toBe("Gönderildi")
    expect(invoiceStatusLabel("CANCELLED")).toBe("İptal")
    expect(invoiceStatusLabel("CONVERTED")).toBe("Dönüştürüldü")
  })

  it("alışta DRAFT 'Kayıtlı'dır — alış belgesinde taslak akışı yok", () => {
    expect(invoiceStatusLabel("DRAFT")).toBe("Taslak")
    expect(invoiceStatusLabel("DRAFT", { isPurchase: true })).toBe("Kayıtlı")
  })

  it("bilinmeyen kod olduğu gibi kalır, boş değer boş döner", () => {
    expect(invoiceStatusLabel("YENI_DURUM")).toBe("YENI_DURUM")
    expect(invoiceStatusLabel(null)).toBe("")
    expect(invoiceStatusLabel("")).toBe("")
  })
})
