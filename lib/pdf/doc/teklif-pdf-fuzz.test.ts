/**
 * Teklif PDF'i — kayma avı (fuzz + karakter karakter büyütme).
 *
 * "Hangi içerik uzunluğunda ne kayıyor" sorusunu gözle aramak imkânsız; bu test
 * onu makineye sorar: alanları rastgele uzunluklarda ve zorlu biçimlerde (boşluksuz
 * dev jetonlar, dev tutarlar, boş alanlar) üretip her üretilen PDF'te yerleşim
 * değişmezlerini doğrular. Tohum sabit → bir hata çıkarsa birebir tekrar üretilir.
 */
import { describe, expect, it } from "vitest"
import { renderTeklifPdf, type TeklifPdfData } from "@/lib/pdf/documents/teklif-document"
import { checkPdf } from "@/lib/pdf/doc/layout-invariants"
import { fuzzAmount, fuzzField, rng, token, words } from "@/lib/pdf/doc/fuzz"

function buildData(rand: () => number): TeklifPdfData {
  const lineCount = 1 + Math.floor(rand() * 4)
  return {
    quoteNo: `TKF-2026-${String(Math.floor(rand() * 999999)).padStart(6, "0")}`,
    date: new Date("2026-08-17"),
    validUntil: rand() < 0.5 ? new Date("2026-09-17") : null,
    currency: ["TRY", "USD", "EUR"][Math.floor(rand() * 3)],
    notes: fuzzField(rand, 400),
    company: {
      name: fuzzField(rand),
      taxNumber: token(rand, 10),
      taxOffice: fuzzField(rand, 80),
      address: fuzzField(rand, 300),
      city: fuzzField(rand, 40),
      phone: token(rand, 11),
      email: `${token(rand, 20)}@${token(rand, 30)}.com.tr`,
      website: `https://${token(rand, 40)}.com`,
    },
    counterparty:
      rand() < 0.9
        ? {
            name: fuzzField(rand),
            taxNumber: token(rand, 11),
            taxOffice: fuzzField(rand, 60),
            address: fuzzField(rand, 250),
            district: fuzzField(rand, 30),
            city: fuzzField(rand, 30),
            phone: token(rand, 11),
            email: `${token(rand, 25)}@${token(rand, 25)}.com`,
          }
        : null,
    counterpartyLabel: "MÜŞTERİ BİLGİLERİ",
    lines: Array.from({ length: lineCount }, () => ({
      description: fuzzField(rand, 180),
      note: rand() < 0.5 ? fuzzField(rand, 200) : null,
      quantity: fuzzAmount(rand),
      unitPrice: fuzzAmount(rand),
      discountAmount: rand() < 0.4 ? fuzzAmount(rand) : 0,
      vatRate: [0, 1, 10, 20][Math.floor(rand() * 4)],
      totalAmount: fuzzAmount(rand),
    })),
    netAmount: fuzzAmount(rand),
    vatAmount: fuzzAmount(rand),
    totalAmount: fuzzAmount(rand),
    discountTotal: rand() < 0.5 ? fuzzAmount(rand) : 0,
    bankAccounts:
      rand() < 0.7
        ? [
            {
              name: fuzzField(rand, 60),
              bankName: fuzzField(rand, 60),
              iban: token(rand, 34),
              currency: "TRY",
            },
          ]
        : [],
  }
}

describe("Teklif PDF — kayma avı", () => {
  it("60 rastgele belge: taşma ve çakışma yok", async () => {
    const failures: string[] = []

    for (let seed = 1; seed <= 60; seed++) {
      const data = buildData(rng(seed))
      const buf = await renderTeklifPdf(data)
      const violations = checkPdf(buf)
      if (violations.length) {
        failures.push(`tohum ${seed}: ${violations.slice(0, 3).map((v) => v.message).join(" | ")}`)
      }
    }

    expect(failures, `yerleşim ihlali:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)

  it("alanlar KARAKTER KARAKTER uzarken hiçbir eşikte kaymaz", async () => {
    const rand = rng(42)
    const base = buildData(rand)
    const failures: string[] = []

    // Kritik alanlar tek tek büyütülür: unvan (sağdaki bloğu iter), ürün adı
    // (tutar kolonunu iter), kalem açıklaması (satırı büyütür).
    for (const field of ["company.name", "line.description", "line.note"] as const) {
      for (let len = 1; len <= 160; len += 3) {
        const text = words(rand, len)
        const data: TeklifPdfData = structuredClone(base)
        if (field === "company.name") data.company.name = text
        if (field === "line.description") data.lines[0].description = text
        if (field === "line.note") data.lines[0].note = text

        const violations = checkPdf(await renderTeklifPdf(data))
        if (violations.length) {
          failures.push(`${field} @ ${len} karakter: ${violations[0].message}`)
          break // aynı alanda ilk eşik yeter
        }
      }
    }

    expect(failures, `kayma eşiği bulundu:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)
})
