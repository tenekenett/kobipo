/**
 * Rapor/liste dışa aktarımı (lib/export/pdf.ts) — kayma avı.
 *
 * Bu üretici diğerlerinden farklı: kolon genişliklerini gerçek font metriğiyle
 * ÖLÇÜYOR, sığmazsa puntoyu kademeli küçültüyor ve gerekirse yatay sayfaya
 * geçiyor. Bu test onun gerçekten taşmadığını doğrular; taşarsa akış tabanlı
 * kite taşımak gerekir.
 */
import { describe, expect, it } from "vitest"
import { buildPdf } from "@/lib/export/pdf"
import type { ExportDataset } from "@/lib/export/types"
import { checkPdf } from "@/lib/pdf/doc/layout-invariants"
import { fuzzAmount, fuzzField, rng, token } from "@/lib/pdf/doc/fuzz"

function buildDataset(rand: () => number): ExportDataset {
  const columnCount = 3 + Math.floor(rand() * 7)
  const types = ["text", "money", "number", "qty", "percent", "date", "boolean"] as const
  const columns = Array.from({ length: columnCount }, (_, i) => ({
    key: `c${i}`,
    label: fuzzField(rand, 30) || `Kolon ${i + 1}`,
    type: types[Math.floor(rand() * types.length)],
    total: rand() < 0.3,
  }))

  const rows = Array.from({ length: 1 + Math.floor(rand() * 25) }, () => {
    const row: Record<string, unknown> = {}
    for (const c of columns) {
      row[c.key] =
        c.type === "text"
          ? rand() < 0.3
            ? token(rand, 10 + Math.floor(rand() * 60))
            : fuzzField(rand, 120)
          : c.type === "date"
            ? new Date("2026-08-17").toISOString()
            : c.type === "boolean"
              ? rand() < 0.5
              : fuzzAmount(rand)
    }
    return row
  })

  return {
    title: fuzzField(rand, 80) || "Rapor",
    company: {
      name: fuzzField(rand) || "Firma",
      taxNumber: token(rand, 10),
      taxOffice: fuzzField(rand, 60),
      address: fuzzField(rand, 220),
      city: fuzzField(rand, 40),
      phone: token(rand, 11),
    },
    filters: rand() < 0.6 ? [fuzzField(rand, 80), fuzzField(rand, 60)] : undefined,
    note: rand() < 0.3 ? fuzzField(rand, 120) : null,
    sections: [{ title: rand() < 0.5 ? fuzzField(rand, 60) : undefined, columns, rows }],
  }
}

describe("Dışa aktarma PDF'i — kayma avı", () => {
  it("40 rastgele rapor: taşma ve çakışma yok", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 40; seed++) {
      const dataset = buildDataset(rng(seed))
      const buf = await buildPdf(dataset)
      // Yatay sayfaya geçebildiği için sayfa genişliği çıktıdan okunur:
      // kenar boşluğu üreticinin sabiti (12mm).
      const runs = checkPdf(Buffer.from(buf), {
        pageWidth: detectPageWidth(Buffer.from(buf)),
        marginLeft: (12 * 72) / 25.4,
        marginRight: (12 * 72) / 25.4,
        tolerance: 3,
      })
      if (runs.length) {
        failures.push(`tohum ${seed}: ${runs.slice(0, 2).map((v) => v.message).join(" | ")}`)
      }
    }
    expect(failures, `yerleşim ihlali:\n${failures.join("\n")}`).toHaveLength(0)
  }, 240_000)
})

/** MediaBox'tan sayfa genişliğini okur (dikey/yatay ayrımı için). */
function detectPageWidth(pdf: Buffer): number {
  const m = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/)
  return m ? parseFloat(m[1]) : 595.28
}
