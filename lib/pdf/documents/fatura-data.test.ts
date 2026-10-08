/**
 * Resmî olmayan fatura PDF'i — içerik. Yerleşim (taşma/çakışma) ayrı:
 * `lib/pdf/doc/fatura-pdf-fuzz.test.ts`.
 */
import { describe, expect, it } from "vitest"
import { computeInvoiceTotals } from "@/lib/invoice/document-totals"
import { extractTextRuns } from "@/lib/pdf/doc/extract-text-runs"
import { stripSoftBreaks } from "@/lib/pdf/doc/safe-text"
import { faturaPdfData, type StoredInvoiceForPdf } from "./fatura-data"
import { faturaTotalRows, renderFaturaPdf, type FaturaPdfData, type FaturaPdfTotals } from "./fatura-document"

const company = { name: "EREN FORKLİFT", taxNumber: "3531285187", taxOffice: "Gökpınar", city: "Denizli" }
const customer = { name: "PEŞİN SATIŞLAR", taxNumber: "12345679895", city: "Denizli" }
const supplier = { name: "PETROL OFİSİ A.Ş.", taxNumber: "7250012345" }

function invoice(over: Partial<StoredInvoiceForPdf> = {}): StoredInvoiceForPdf {
  return {
    invoiceNo: "SAT-2026-0108",
    eDocumentNo: null,
    date: new Date("2026-09-30T00:00:00Z"),
    dueDate: null,
    type: "SALES",
    status: "DRAFT",
    currency: "TRY",
    notes: "eren vinç c.özkan satıldı",
    netAmount: 9500,
    vatAmount: 1900,
    totalAmount: 11400,
    company,
    customer,
    supplier: null,
    items: [
      {
        description: "PETROL OFİSİ LA 10W40 20 LT.",
        quantity: 2,
        unit: "ADET",
        unitPrice: 4750,
        discountAmount: 0,
        vatRate: 20,
        vatAmount: 1900,
      },
    ],
    ...over,
  }
}

/**
 * Kayıtlı kalemler: toplam document-totals'tan (kaydeden yolla aynı kural), kalem
 * vergileri genel iskonto UYGULANMADAN (DB'deki gibi).
 */
function stored(
  lines: Array<{ quantity: number; unitPrice: number; discountAmount: number; vatRate: number; withholdingRate?: number }>,
  adjustments: { globalDiscountAmount?: number; globalChargeAmount?: number } = {},
): Partial<StoredInvoiceForPdf> {
  const t = computeInvoiceTotals(lines, adjustments)
  return {
    netAmount: t.net,
    vatAmount: t.vat,
    totalAmount: t.total,
    globalDiscountAmount: adjustments.globalDiscountAmount ?? 0,
    globalChargeAmount: adjustments.globalChargeAmount ?? 0,
    items: lines.map((l, i) => {
      const net = l.quantity * l.unitPrice - l.discountAmount
      const vat = Math.round(net * l.vatRate) / 100
      return {
        description: `Kalem ${i + 1}`,
        ...l,
        vatAmount: vat,
        withholdingAmount: l.withholdingRate ? Math.round(vat * l.withholdingRate) / 100 : 0,
      }
    }),
  }
}

/** Dip toplam yukarıdan aşağı toplandığında genel toplamı KURUŞU KURUŞUNA vermeli. */
const sumTotals = (t: FaturaPdfTotals) =>
  Math.round((t.grossTotal - t.lineDiscountTotal + t.globalAdjustment - t.withholdingAmount + t.rounding) * 100) / 100

/** Her satırda miktar × birim fiyat − iskonto = tutar; satırlar ara toplamı verir. */
function expectLinesConsistent(data: FaturaPdfData) {
  for (const l of data.lines) {
    expect(l.quantity * l.unitPrice - l.discountAmount).toBeCloseTo(l.lineTotal, 2)
  }
  const lineSum = data.lines.reduce((s, l) => s + l.lineTotal, 0)
  expect(data.totals.grossTotal - data.totals.lineDiscountTotal).toBeCloseTo(lineSum, 2)
}

async function pdfText(inv: StoredInvoiceForPdf) {
  return extractTextRuns(await renderFaturaPdf(faturaPdfData(inv, null)))
    .map((r) => stripSoftBreaks(r.text))
    .join("")
    .replace(/\s+/g, "")
}

const squash = (s: string) => s.replace(/\s+/g, "")

describe("faturaPdfData — vergiler dahil, KDV yazılmaz", () => {
  it("ekran görüntüsündeki belge: birim fiyat 5.700, tutar 11.400, Ara Toplam = GENEL TOPLAM", () => {
    const data = faturaPdfData(invoice(), null)
    expect(data.lines[0]).toMatchObject({ quantity: 2, unitPrice: 5700, lineTotal: 11400, discountAmount: 0 })
    expect(faturaTotalRows(data.totals, "TRY").map((r) => [r.label, r.value])).toEqual([
      ["Ara Toplam", "₺11.400,00"],
      ["GENEL TOPLAM", "₺11.400,00"],
    ])
    expect(data.counterpartyLabel).toBe("MÜŞTERİ BİLGİLERİ")
  })

  it("satır + genel iskonto: ikisi de vergiler dahil görünür, kırılım kayıtlı toplamı verir", () => {
    const data = faturaPdfData(
      invoice(
        stored(
          [
            { quantity: 2, unitPrice: 100, discountAmount: 20, vatRate: 20 },
            { quantity: 1, unitPrice: 50, discountAmount: 0, vatRate: 10 },
          ],
          { globalDiscountAmount: 13 },
        ),
      ),
      null,
    )
    expect(faturaTotalRows(data.totals, "TRY").map((r) => r.label)).toEqual([
      "Ara Toplam",
      "Satır İskontosu",
      "Genel İskonto",
      "GENEL TOPLAM",
    ])
    // Satır iskontosu 20 TL + %20 KDV.
    expect(data.lines[0]).toMatchObject({ unitPrice: 120, discountAmount: 24, lineTotal: 216 })
    expect(data.totals.rounding).toBe(0)
    expect(sumTotals(data.totals)).toBe(data.totals.totalAmount)
    expectLinesConsistent(data)
  })

  it("fatura altı ilave pozitif satır olarak görünür", () => {
    const data = faturaPdfData(
      invoice(stored([{ quantity: 3, unitPrice: 33.33, discountAmount: 0, vatRate: 20 }], { globalChargeAmount: 10 })),
      null,
    )
    expect(faturaTotalRows(data.totals, "TRY").map((r) => r.label)).toContain("Fatura Altı İlave")
    expect(data.totals.globalAdjustment).toBeGreaterThan(0)
    expect(sumTotals(data.totals)).toBe(data.totals.totalAmount)
  })

  it("tevkifat ayrı satır ('Tevkifat'), kırılım genel iskontoyla birlikte de tutar", () => {
    const data = faturaPdfData(
      invoice(
        stored([{ quantity: 1, unitPrice: 1000, discountAmount: 0, vatRate: 20, withholdingRate: 50 }], {
          globalDiscountAmount: 100,
        }),
      ),
      null,
    )
    const labels = faturaTotalRows(data.totals, "TRY").map((r) => r.label)
    expect(labels).toEqual(["Ara Toplam", "İskonto", "Tevkifat", "GENEL TOPLAM"])
    expect(data.totals.withholdingAmount).toBe(90)
    expect(sumTotals(data.totals)).toBe(data.totals.totalAmount)
  })

  it("satır ile başlık arasındaki kuruş farkı (eski kayıt) 'Yuvarlama' olarak görünür, gizlenmez", () => {
    const data = faturaPdfData(invoice({ totalAmount: 11400.01 }), null)
    expect(data.totals.rounding).toBe(0.01)
    expect(faturaTotalRows(data.totals, "TRY").map((r) => r.label)).toContain("Yuvarlama")
    expect(sumTotals(data.totals)).toBe(11400.01)
  })

  it("alış faturasında karşı taraf tedarikçi; iadede kayıtlı cari", () => {
    expect(faturaPdfData(invoice({ type: "PURCHASE", customer: null, supplier }), null).counterpartyLabel).toBe(
      "TEDARİKÇİ BİLGİLERİ",
    )
    expect(faturaPdfData(invoice({ type: "RETURN" }), null).counterparty?.name).toBe("PEŞİN SATIŞLAR")
    expect(faturaPdfData(invoice({ type: "RETURN", customer: null, supplier }), null).counterpartyLabel).toBe(
      "TEDARİKÇİ BİLGİLERİ",
    )
  })

  it("belgede KDV ve GİB düzeninin izi yok, resmî olmadığı yazıyor", async () => {
    const text = await pdfText(invoice())
    for (const word of ["FATURA", "SAT-2026-0108", "₺5.700,00", "GENEL TOPLAM", "resmî fatura yerine geçmez"]) {
      expect(text).toContain(squash(word))
    }
    for (const word of ["KDV", "Matrah", "Ödenecek", "ETTN", "Senaryo", "e-ARŞİV", "TASLAK", "%20"]) {
      expect(text).not.toContain(squash(word))
    }
  }, 30_000)
})
