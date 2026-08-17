/**
 * Etiket (barkod/fiyat) PDF'i — taşma avı.
 *
 * Etiket belgelerden farklı: çıkartma BÜYÜYEMEZ, dolayısıyla doğru davranış
 * kutuya sığmayan metni üç noktayla kısaltmaktır. Bu test uzun ürün adları,
 * kodlar ve fiyatlarla etiket basıp HER metnin kendi etiket hücresinde kaldığını
 * doğrular — komşu çıkartmaya taşan tek satır bile hatadır.
 *
 * Etiket motoru istemci tarafı olduğu için font `fetch("/fonts/...")` ile
 * yükleniyor; testte fetch diskten beslenir.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { STARTER_TEMPLATES } from "@/lib/labels/presets"
import { generateLabelPdf } from "@/lib/pdf/label-pdf"
import { extractTextRuns, ptToMm } from "@/lib/pdf/doc/extract-text-runs"
import { fuzzField, rng, token } from "@/lib/pdf/doc/fuzz"

function stubFontFetch() {
  vi.stubGlobal("fetch", async (url: unknown) => {
    const file = String(url).split("/").pop() || ""
    const buf = readFileSync(path.join(process.cwd(), "public", "fonts", file))
    return {
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as any
  })
}

describe("Etiket PDF'i — taşma avı", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uzun ürün adları etiket kutusunun dışına taşmaz", async () => {
    stubFontFetch()
    const rand = rng(4)
    const template = STARTER_TEMPLATES[0] // Fiyat Etiketi 40×20 (rulo)
    const page = template.design.page

    const products = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      name: i % 2 === 0 ? fuzzField(rand, 160) : token(rand, 80),
      code: token(rand, 40),
      barcode: "8691234567890",
      salePrice: 123456.78,
      vatRate: 20,
      unit: "ADET",
    }))

    const blob = await generateLabelPdf(
      template.design,
      products.map((product) => ({ product: product as any, quantity: 1 })),
      { name: fuzzField(rand, 120) || "Firma" } as any,
    )
    const buf = Buffer.from(await blob.arrayBuffer())
    const runs = extractTextRuns(buf)
    expect(runs.length).toBeGreaterThan(0)

    // Rulo düzeninde sayfa = bir sıra etiket; hücre sınırı sayfa genişliğidir.
    const cols = Math.max(1, page.columns)
    const pageWidthMm = cols * page.widthMm + (cols - 1) * page.gapXMm

    const overflowing = runs.filter((r) => {
      const startMm = ptToMm(r.x)
      const endMm = ptToMm(r.x + r.width)
      return startMm < -0.5 || endMm > pageWidthMm + 0.5
    })

    const detail = overflowing
      .map(
        (r) =>
          `"${r.text.slice(0, 30)}" ${ptToMm(r.x).toFixed(1)}→${ptToMm(r.x + r.width).toFixed(1)}mm ` +
          `(etiket genişliği ${pageWidthMm}mm)`,
      )
      .join("\n")
    expect(overflowing, `etiket dışına taşan metin:\n${detail}`).toHaveLength(0)
  }, 120_000)

  it("çok uzun tek kelime kısaltılır ve etikette kalır", async () => {
    stubFontFetch()
    const template = STARTER_TEMPLATES[1] // Barkod Etiketi 50×30
    const longWord = "X".repeat(300)

    const blob = await generateLabelPdf(
      template.design,
      [
        {
          product: {
            id: "p1",
            name: longWord,
            code: "K1",
            barcode: "8691234567890",
            salePrice: 99.9,
            vatRate: 20,
          } as any,
          quantity: 1,
        },
      ],
      { name: "Firma" } as any,
    )
    const buf = Buffer.from(await blob.arrayBuffer())
    const runs = extractTextRuns(buf)
    const pageWidthMm = template.design.page.widthMm

    for (const r of runs) {
      expect(
        ptToMm(r.x + r.width),
        `"${r.text.slice(0, 20)}" etiketten taşıyor`,
      ).toBeLessThanOrEqual(pageWidthMm + 0.5)
    }
    // Kısaltma yapıldığının işareti: üç nokta.
    expect(runs.some((r) => r.text.includes("…"))).toBe(true)
  }, 120_000)
})
