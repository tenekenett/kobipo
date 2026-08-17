/**
 * GİB düzeni fatura PDF'i — kayma avı.
 *
 * Bu belge en hassas olanı: iki taraf künyesi, sağ üstte bilgi kutusu, 8 kolonlu
 * kalem tablosu, uzun dip toplam listesi ve "yalnız (yazıyla)" satırı aynı sayfada.
 * Eski jsPDF sürümünde bloklar birbirinin y imlecinden besleniyordu; uzun bir
 * unvan tüm zinciri kaydırıyordu.
 */
import { describe, expect, it } from "vitest"
import {
  generateGibInvoicePdfBuffer,
  type GibInvoiceData,
} from "@/lib/pdf/gib-invoice-pdf"
import { checkPdf } from "@/lib/pdf/doc/layout-invariants"
import { fuzzAmount, fuzzField, rng, token, words } from "@/lib/pdf/doc/fuzz"

function buildData(rand: () => number): GibInvoiceData {
  const lineCount = 1 + Math.floor(rand() * 5)
  return {
    invoiceNo: rand() < 0.2 ? "" : `KKD2026${String(Math.floor(rand() * 999999)).padStart(9, "0")}`,
    ettn: rand() < 0.5 ? token(rand, 36) : null,
    date: new Date("2026-08-17").toISOString(),
    dueDate: rand() < 0.5 ? new Date("2026-09-17").toISOString() : null,
    type: ["SALES", "PURCHASE", "RETURN"][Math.floor(rand() * 3)],
    invoiceType: (["E_INVOICE", "E_ARCHIVE", "MANUAL"] as const)[Math.floor(rand() * 3)],
    currency: ["TRY", "USD", "EUR"][Math.floor(rand() * 3)],
    isDraft: rand() < 0.6,
    notes: fuzzField(rand, 400),
    company: {
      name: fuzzField(rand),
      taxNumber: token(rand, 10),
      taxOffice: fuzzField(rand, 70),
      address: fuzzField(rand, 260),
      district: fuzzField(rand, 30),
      city: fuzzField(rand, 30),
      phone: token(rand, 11),
      email: `${token(rand, 20)}@${token(rand, 25)}.com.tr`,
    },
    counterparty:
      rand() < 0.9
        ? {
            name: fuzzField(rand),
            taxNumber: token(rand, 11),
            taxOffice: fuzzField(rand, 70),
            address: fuzzField(rand, 260),
            district: fuzzField(rand, 30),
            city: fuzzField(rand, 30),
            phone: token(rand, 11),
            email: `${token(rand, 22)}@${token(rand, 22)}.com`,
          }
        : null,
    items: Array.from({ length: lineCount }, () => ({
      description: fuzzField(rand, 180),
      note: rand() < 0.5 ? fuzzField(rand, 200) : null,
      quantity: fuzzAmount(rand),
      unit: ["ADET", "KG", "METRE", "PAKET"][Math.floor(rand() * 4)],
      unitPrice: fuzzAmount(rand),
      discountAmount: rand() < 0.4 ? fuzzAmount(rand) : 0,
      vatRate: [0, 1, 10, 20][Math.floor(rand() * 4)],
      vatAmount: fuzzAmount(rand),
      withholdingRate: rand() < 0.25 ? [20, 50, 70, 90][Math.floor(rand() * 4)] : 0,
      lineNet: fuzzAmount(rand),
    })),
    totals: {
      grossTotal: fuzzAmount(rand),
      lineDiscountTotal: rand() < 0.5 ? fuzzAmount(rand) : 0,
      globalDiscount: rand() < 0.4 ? fuzzAmount(rand) : 0,
      globalCharge: rand() < 0.3 ? fuzzAmount(rand) : 0,
      rounding: rand() < 0.3 ? (rand() - 0.5) * 2 : 0,
      netAmount: fuzzAmount(rand),
      vatBaseAmount: fuzzAmount(rand),
      vatAmount: fuzzAmount(rand),
      withholdingAmount: rand() < 0.3 ? fuzzAmount(rand) : 0,
      exciseAmount: rand() < 0.3 ? fuzzAmount(rand) : 0,
      otherTaxAmount: rand() < 0.3 ? fuzzAmount(rand) : 0,
      otherTaxInBaseAmount: rand() < 0.2 ? fuzzAmount(rand) : 0,
      gekapAmount: rand() < 0.3 ? fuzzAmount(rand) : 0,
      otherTaxLabel: rand() < 0.5 ? fuzzField(rand, 40) : null,
      totalAmount: fuzzAmount(rand),
    },
  }
}

describe("GİB düzeni PDF — kayma avı", () => {
  it("60 rastgele belge: taşma ve çakışma yok", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const violations = checkPdf(await generateGibInvoicePdfBuffer(buildData(rng(seed))))
      if (violations.length) {
        failures.push(`tohum ${seed}: ${violations.slice(0, 3).map((v) => v.message).join(" | ")}`)
      }
    }
    expect(failures, `yerleşim ihlali:\n${failures.join("\n")}`).toHaveLength(0)
  }, 240_000)

  it("alanlar KARAKTER KARAKTER uzarken hiçbir eşikte kaymaz", async () => {
    const rand = rng(11)
    const base = buildData(rand)
    const failures: string[] = []

    for (const field of ["company.name", "counterparty.name", "item.description"] as const) {
      for (let len = 1; len <= 160; len += 3) {
        const text = words(rand, len)
        const data: GibInvoiceData = structuredClone(base)
        if (field === "company.name") data.company.name = text
        if (field === "counterparty.name" && data.counterparty) data.counterparty.name = text
        if (field === "item.description") data.items[0].description = text

        const violations = checkPdf(await generateGibInvoicePdfBuffer(data))
        if (violations.length) {
          failures.push(`${field} @ ${len} karakter: ${violations[0].message}`)
          break
        }
      }
    }
    expect(failures, `kayma eşiği bulundu:\n${failures.join("\n")}`).toHaveLength(0)
  }, 240_000)

  it("taslak filigranı metin yerleşimini bozmaz", async () => {
    const data = buildData(rng(5))
    const draft = checkPdf(await generateGibInvoicePdfBuffer({ ...data, isDraft: true }))
    const final = checkPdf(await generateGibInvoicePdfBuffer({ ...data, isDraft: false }))
    expect(draft).toHaveLength(0)
    expect(final).toHaveLength(0)
  }, 60_000)
})
