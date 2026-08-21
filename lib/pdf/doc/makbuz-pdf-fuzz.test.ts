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

  // Çek/senet makbuzunda hesap satırı yok, yerine evrak künyesi (çek no, banka,
  // şube, vade, durum) geliyor ve başlığa araç adı ekleniyor. Kasa/banka
  // makbuzundan farklı bir bilgi tablosu — kendi kayma avı olmalı.
  it("çek/senet makbuzu (hesapsız, evrak künyeli): taşma ve çakışma yok", async () => {
    const failures: string[] = []
    for (let seed = 101; seed <= 130; seed++) {
      const rand = rng(seed)
      const instrument = rand() < 0.5 ? "Çek" : "Senet"
      const data: MakbuzPdfData = {
        ...buildData(rand),
        kind: rand() < 0.5 ? "Tahsilat" : "Ödeme",
        instrument,
        account: null,
        extraRows: [
          { label: `${instrument} No`, value: token(rand, 4 + Math.floor(rand() * 40)) },
          ...(instrument === "Çek"
            ? [
                { label: "Banka", value: fuzzField(rand, 80) },
                { label: "Şube", value: fuzzField(rand, 80) },
                { label: "Hesap No", value: token(rand, 26) },
              ]
            : []),
          { label: "Düzenleme Tarihi", value: "17.08.2026" },
          { label: "Vade Tarihi", value: "17.11.2026" },
          { label: "Durum", value: "Portföyde" },
        ],
      }
      const violations = checkPdf(await renderMakbuzPdf(data))
      if (violations.length) {
        failures.push(`tohum ${seed}: ${violations.slice(0, 3).map((v) => v.message).join(" | ")}`)
      }
    }
    expect(failures, `yerleşim ihlali:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)
})
