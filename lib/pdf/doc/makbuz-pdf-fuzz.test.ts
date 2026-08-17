/** Makbuz PDF'i — kayma avı (fuzz + karakter karakter büyütme). */
import { describe, expect, it } from "vitest"
import { renderMakbuzPdf, type MakbuzPdfData } from "@/lib/pdf/documents/makbuz-document"
import { checkPdf } from "@/lib/pdf/doc/layout-invariants"
import { fuzzAmount, fuzzField, rng, token, words } from "@/lib/pdf/doc/fuzz"

function buildData(rand: () => number): MakbuzPdfData {
  return {
    kind: ["Tahsilat", "Ödeme", "Gelir", "Gider"][Math.floor(rand() * 4)],
    makbuzNo: token(rand, 8 + Math.floor(rand() * 30)),
    date: new Date("2026-08-17").toISOString(),
    amount: fuzzAmount(rand),
    currency: ["TRY", "USD", "EUR"][Math.floor(rand() * 3)],
    description: fuzzField(rand, 300),
    reference: rand() < 0.6 ? fuzzField(rand, 60) : null,
    paymentMethod: fuzzField(rand, 40),
    account: { name: fuzzField(rand, 70), bankName: rand() < 0.6 ? fuzzField(rand, 60) : null },
    company: {
      name: fuzzField(rand),
      taxNumber: token(rand, 10),
      address: fuzzField(rand, 260),
      city: fuzzField(rand, 40),
      phone: token(rand, 11),
    },
    cari:
      rand() < 0.8
        ? {
            label: rand() < 0.5 ? "MÜŞTERİ" : "TEDARİKÇİ",
            name: fuzzField(rand),
            taxNumber: token(rand, 11),
          }
        : null,
    invoices: Array.from({ length: Math.floor(rand() * 4) }, () => ({
      invoiceNo: token(rand, 12),
      amount: fuzzAmount(rand),
    })),
  }
}

describe("Makbuz PDF — kayma avı", () => {
  it("50 rastgele belge: taşma ve çakışma yok", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 50; seed++) {
      const violations = checkPdf(await renderMakbuzPdf(buildData(rng(seed))))
      if (violations.length) {
        failures.push(`tohum ${seed}: ${violations.slice(0, 3).map((v) => v.message).join(" | ")}`)
      }
    }
    expect(failures, `yerleşim ihlali:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)

  it("firma unvanı ve cari adı KARAKTER KARAKTER uzarken kaymaz", async () => {
    const rand = rng(21)
    const base = buildData(rand)
    const failures: string[] = []

    for (const field of ["company.name", "cari.name"] as const) {
      for (let len = 1; len <= 160; len += 3) {
        const text = words(rand, len)
        const data: MakbuzPdfData = structuredClone(base)
        if (field === "company.name") data.company.name = text
        if (field === "cari.name" && data.cari) data.cari.name = text

        const violations = checkPdf(await renderMakbuzPdf(data))
        if (violations.length) {
          failures.push(`${field} @ ${len} karakter: ${violations[0].message}`)
          break
        }
      }
    }
    expect(failures, `kayma eşiği bulundu:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)
})
