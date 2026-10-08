/**
 * Fatura PDF'i — kayma avı (fuzz + karakter karakter büyütme).
 * Teklif testiyle aynı değişmezler: taşma yok, çakışma yok, alanlar kırpılmıyor.
 */
import { beforeAll, describe, expect, it } from "vitest"
import sharp from "sharp"
import type { CompanyLogo } from "@/lib/company/logo"
import { renderFaturaPdf, type FaturaPdfData } from "@/lib/pdf/documents/fatura-document"
import { checkPdf } from "@/lib/pdf/doc/layout-invariants"
import { extractTextRuns } from "@/lib/pdf/doc/extract-text-runs"
import { fuzzAmount, fuzzField, rng, token, words } from "@/lib/pdf/doc/fuzz"
import { stripSoftBreaks } from "@/lib/pdf/doc/safe-text"

// Logolu belge: sağ üst kolon logoyla uzar — geniş ve dik iki oran da denenir.
let LOGOS: CompanyLogo[] = []
beforeAll(async () => {
  const png = async (width: number, height: number) => {
    const buf = await sharp({ create: { width, height, channels: 4, background: "#143d6b" } }).png().toBuffer()
    return { dataUri: `data:image/png;base64,${buf.toString("base64")}`, pixelWidth: width, pixelHeight: height }
  }
  LOGOS = [await png(400, 120), await png(120, 160), { ...(await png(774, 267)), kobipo: true }]
})

function buildData(rand: () => number): FaturaPdfData {
  const lineCount = 1 + Math.floor(rand() * 5)
  return {
    invoiceNo: `SAT-2026-${String(Math.floor(rand() * 9999)).padStart(4, "0")}`,
    date: new Date("2026-08-17"),
    dueDate: rand() < 0.5 ? new Date("2026-09-17") : null,
    type: ["SALES", "PURCHASE", "RETURN"][Math.floor(rand() * 3)],
    currency: ["TRY", "USD", "EUR"][Math.floor(rand() * 3)],
    notes: fuzzField(rand, 400),
    cancelled: rand() < 0.1,
    logo: rand() < 0.6 ? LOGOS[Math.floor(rand() * LOGOS.length)] : null,
    company: {
      name: fuzzField(rand),
      taxNumber: token(rand, 10),
      taxOffice: fuzzField(rand, 80),
      address: fuzzField(rand, 300),
      city: fuzzField(rand, 40),
      phone: token(rand, 11),
      email: `${token(rand, 20)}@${token(rand, 25)}.com.tr`,
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
          }
        : null,
    counterpartyLabel: "MÜŞTERİ BİLGİLERİ",
    lines: Array.from({ length: lineCount }, () => ({
      description: fuzzField(rand, 180),
      note: rand() < 0.5 ? fuzzField(rand, 200) : null,
      quantity: fuzzAmount(rand),
      unit: rand() < 0.7 ? ["ADET", "KG", "LT", "SAAT"][Math.floor(rand() * 4)] : null,
      unitPrice: fuzzAmount(rand),
      discountAmount: rand() < 0.4 ? fuzzAmount(rand) : 0,
      discountRate: rand() < 0.3 ? 12.5 : null,
      lineTotal: fuzzAmount(rand),
    })),
    totals: {
      grossTotal: fuzzAmount(rand),
      lineDiscountTotal: rand() < 0.5 ? fuzzAmount(rand) : 0,
      globalAdjustment: rand() < 0.4 ? (rand() < 0.8 ? -1 : 1) * fuzzAmount(rand) : 0,
      withholdingAmount: rand() < 0.2 ? fuzzAmount(rand) : 0,
      rounding: rand() < 0.2 ? -0.03 : 0,
      totalAmount: fuzzAmount(rand),
    },
  }
}

describe("Fatura PDF — kayma avı", () => {
  it("60 rastgele belge: taşma ve çakışma yok", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const violations = checkPdf(await renderFaturaPdf(buildData(rng(seed))))
      if (violations.length) {
        failures.push(`tohum ${seed}: ${violations.slice(0, 3).map((v) => v.message).join(" | ")}`)
      }
    }
    expect(failures, `yerleşim ihlali:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)

  it("alanlar KARAKTER KARAKTER uzarken hiçbir eşikte kaymaz", async () => {
    const rand = rng(7)
    const base = buildData(rand)
    const failures: string[] = []

    for (const field of ["company.name", "counterparty.address", "line.description"] as const) {
      for (let len = 1; len <= 160; len += 3) {
        const text = words(rand, len)
        const data: FaturaPdfData = structuredClone(base)
        if (field === "company.name") data.company.name = text
        if (field === "counterparty.address" && data.counterparty) data.counterparty.address = text
        if (field === "line.description") data.lines[0].description = text

        const violations = checkPdf(await renderFaturaPdf(data))
        if (violations.length) {
          failures.push(`${field} @ ${len} karakter: ${violations[0].message}`)
          break
        }
      }
    }
    expect(failures, `kayma eşiği bulundu:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)

  it("uzun alanlar kırpılmaz (eski sürüm 2/1 satıra buduyordu)", async () => {
    const data = buildData(rng(3))
    const longName = "Çok Uzun Unvanlı Anonim Şirketi Sanayi ve Ticaret Limited Şirketi Denizli Şubesi"
    const longAddress = "Üniversite Caddesi No 45 Kat 3 Daire 7 Pamukkale Denizli Türkiye ek bilgi satırı"
    data.counterparty = { ...(data.counterparty || {}), name: longName, address: longAddress }

    const text = extractTextRuns(await renderFaturaPdf(data))
      .map((r) => stripSoftBreaks(r.text))
      .join(" ")
      .replace(/\s+/g, "")

    for (const word of ["Şubesi", "Daire", "Türkiye"]) {
      expect(text, `"${word}" belgede yok (kırpılmış)`).toContain(word)
    }
  }, 60_000)
})
