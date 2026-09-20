// ÇEK/SENET FATURA BAĞI — gövdeden kayıt alanlarına.
//
// `invoiceIds` yeni kaynak, `invoiceId` listenin ilki (eski okuyucular). İkisi
// ayrışırsa makbuz bir faturayı, detay başka bir listeyi gösterir.

import { describe, expect, it } from "vitest"
import { hasInvoiceLinkField, invoiceLinkData, linkedInvoiceIds, normalizeInvoiceLinks } from "./fatura-bagi"

describe("çek/senet fatura bağı", () => {
  it("yeni dizi ve eski tek alan birleşir, tekrar ve boş elenir, sıra korunur", () => {
    expect(normalizeInvoiceLinks({ invoiceIds: ["b", " a ", "", "b"], invoiceId: "c" })).toEqual(["b", "a", "c"])
    expect(normalizeInvoiceLinks({ invoiceId: null })).toEqual([])
    expect(normalizeInvoiceLinks({ invoiceIds: [1, undefined, "x"] })).toEqual(["x"])
  })

  it("yazılacak alanlar birlikte üretilir: invoiceId = ilki, boşta null", () => {
    expect(invoiceLinkData(["a", "b"])).toEqual({ invoiceIds: ["a", "b"], invoiceId: "a" })
    expect(invoiceLinkData([])).toEqual({ invoiceIds: [], invoiceId: null })
  })

  it("PUT'ta bağ alanı gelmediyse dokunulmaz", () => {
    expect(hasInvoiceLinkField({})).toBe(false)
    expect(hasInvoiceLinkField({ invoiceIds: [] })).toBe(true)
    expect(hasInvoiceLinkField({ invoiceId: null })).toBe(true)
  })

  it("okurken yeni liste boşsa eski tek alana düşer (migrasyon öncesi kayıt)", () => {
    expect(linkedInvoiceIds({ invoiceIds: ["x", "y"], invoiceId: "x" })).toEqual(["x", "y"])
    expect(linkedInvoiceIds({ invoiceIds: [], invoiceId: "z" })).toEqual(["z"])
    expect(linkedInvoiceIds({ invoiceIds: null, invoiceId: null })).toEqual([])
  })
})
