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

  it("Manuel (kâğıt/matbu, taranmış) satışta DRAFT 'Kayıtlı'dır; e-belge taslağı 'Taslak' kalır", () => {
    expect(invoiceStatusLabel("DRAFT", { invoiceType: "MANUAL" })).toBe("Kayıtlı")
    expect(invoiceStatusLabel("DRAFT", { invoiceType: "E_ARCHIVE" })).toBe("Taslak")
    expect(invoiceStatusLabel("DRAFT", { invoiceType: "E_INVOICE" })).toBe("Taslak")
    // GİB taslağı Manuel belgede oluşmaz ama etiket durumdan bağımsız sabit kalır.
    expect(invoiceStatusLabel("GIB_DRAFT", { invoiceType: "E_ARCHIVE" })).toBe("GİB Taslağı")
  })

  it("KDV kuralıyla aynı tanım: 'Kayıtlı' görünen satış belgesi KDV'ye girer", async () => {
    const { kdvyeGirerMi } = await import("@/lib/raporlar/kdv-kural")
    for (const invoiceType of ["MANUAL", "E_ARCHIVE", "E_INVOICE"]) {
      const kayitli = invoiceStatusLabel("DRAFT", { invoiceType }) === "Kayıtlı"
      expect(kdvyeGirerMi({ type: "SALES", status: "DRAFT", invoiceType })).toBe(kayitli)
    }
  })

  it("bilinmeyen kod olduğu gibi kalır, boş değer boş döner", () => {
    expect(invoiceStatusLabel("YENI_DURUM")).toBe("YENI_DURUM")
    expect(invoiceStatusLabel(null)).toBe("")
    expect(invoiceStatusLabel("")).toBe("")
  })
})
