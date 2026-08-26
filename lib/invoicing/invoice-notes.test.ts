/**
 * Otomatik kesilen satış faturasının NOT satırlarının testleri.
 *
 * Bu satırlar bir süsleme değil: satışın internetten yapıldığı, ödemenin nasıl/ne zaman
 * alındığı ve tutarın yazıyla karşılığı belgede görünmek zorunda. Bilgiyi yapısal
 * "internet satışı" alanına yazmak GİB şablonuna mesafeli satış İADE BÖLÜMÜ tablosunu
 * ekletiyordu (dijital hizmette iade edilecek ürün yok), o yüzden aynı bilgi NOT olarak
 * basılıyor — testler o metnin kaybolmamasını kilitler.
 */

import { describe, expect, it } from "vitest"
import { buildInvoiceNotes, type OrderView } from "./issue-sales-invoice"

const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: "ord_1",
  buyerCompanyId: "cmp_2",
  gross: 375,
  currency: "TRY",
  paidAt: new Date("2026-08-26T09:46:00.000Z"),
  paymentMethod: "CARD",
  isTest: false,
  invoiceId: null,
  vatRate: 20,
  description: "100 Kontör — 100 adet e-Belge kontörü",
  reference: "N3IXQ7JQ",
  productName: "E-Belge Kontörü",
  discount: null,
  billing: {
    name: "Alıcı A.Ş.",
    taxNumber: "3530589517",
    taxOffice: "Gökpınar",
    address: "Akçeşme Mah.",
    city: "Denizli",
    district: "Merkezefendi",
    email: "alici@example.com",
  },
  ...over,
})

describe("buildInvoiceNotes", () => {
  it("sipariş no, kalem, internet ibaresi, ödeme, yazıyla tutar ve adresi basar", () => {
    const lines = buildInvoiceNotes(order(), 375).split("\n")
    expect(lines[0]).toBe("Kobipo sipariş no: N3IXQ7JQ")
    expect(lines[1]).toBe("100 Kontör — 100 adet e-Belge kontörü")
    expect(lines[2]).toBe("Bu satış internet üzerinden yapılmıştır.")
    expect(lines[3]).toContain("Kredi Kartı / Banka Kartı")
    expect(lines[3]).toContain("PayTR")
    // Ödeme tarihi mükellefin takvim günüyle (Europe/Istanbul) yazılır.
    expect(lines[3]).toContain("26.08.2026")
    expect(lines[4]).toBe("Yalnız: ÜÇ YÜZ YETMİŞ BEŞ TL")
    expect(lines[5]).toMatch(/^Web: https?:\/\//)
  })

  it("havalede ödeme aracısı yazılmaz — para doğrudan bankaya geçer", () => {
    const notes = buildInvoiceNotes(order({ paymentMethod: "HAVALE" }), 375)
    expect(notes).toContain("Havale / EFT")
    expect(notes).not.toContain("PayTR")
  })

  it("kuruşlu tutarı yazıyla tam basar", () => {
    expect(buildInvoiceNotes(order(), 312.5)).toContain("Yalnız: ÜÇ YÜZ ON İKİ TL ELLİ KR")
  })

  it("tahsilat anı yoksa ödeme satırına tarih eklemez (uydurmaz)", () => {
    const notes = buildInvoiceNotes(order({ paidAt: null }), 375)
    const paymentLine = notes.split("\n").find((l) => l.startsWith("Ödeme:"))!
    expect(paymentLine).not.toMatch(/\d{2}\.\d{2}\.\d{4}/)
  })

  it("indirim kodu uygulanmışsa kodu ve tutarı belgeye yazar", () => {
    const notes = buildInvoiceNotes(
      order({ discount: { code: "YAZ25", amount: 37.5 } }),
      337.5,
    )
    expect(notes).toContain("İndirim kodu: YAZ25")
    expect(notes).toContain("37,50")
    // Yazıyla tutar TAHSİL EDİLEN tutardır, liste değil.
    expect(notes).toContain("Yalnız: ÜÇ YÜZ OTUZ YEDİ TL ELLİ KR")
  })

  it("açıklama sipariş satırıyla aynıysa iki kez yazmaz", () => {
    const notes = buildInvoiceNotes(
      order({ description: "Kobipo sipariş no: N3IXQ7JQ" }),
      375,
    )
    expect(notes.split("\n").filter((l) => l === "Kobipo sipariş no: N3IXQ7JQ")).toHaveLength(1)
  })
})
