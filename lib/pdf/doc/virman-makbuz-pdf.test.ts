/** Virman makbuzu PDF'i — metin kuralı + kayma avı. */
import { describe, expect, it } from "vitest"
import {
  renderVirmanMakbuzPdf,
  virmanOzetCumlesi,
  type VirmanMakbuzPdfData,
} from "@/lib/pdf/documents/virman-makbuz-document"
import { virmanEtkiBelgeMetni } from "@/lib/cari/virman"
import { checkPdf } from "@/lib/pdf/doc/layout-invariants"
import { fuzzAmount, fuzzField, rng, token } from "@/lib/pdf/doc/fuzz"

describe("virmanOzetCumlesi", () => {
  it("iki taraflı: alacaklanan → borçlanan", () => {
    const s = virmanOzetCumlesi(
      [
        { side: "DEBIT", kind: "supplier", name: "XYZ" },
        { side: "CREDIT", kind: "customer", name: "ABC" },
      ],
      10000,
    )
    expect(s).toContain("ABC hesabına alacak")
    expect(s).toContain("XYZ hesabına borç")
  })

  it("tek taraflı fiş bunu söyler", () => {
    const s = virmanOzetCumlesi([{ side: "CREDIT", kind: "customer", name: "ABC" }], 50)
    expect(s).toContain("ABC hesabına alacak")
    expect(s).toContain("tek taraflı")
  })
})

function buildData(rand: () => number): VirmanMakbuzPdfData {
  const leg = (side: "DEBIT" | "CREDIT") => ({
    side,
    kind: rand() < 0.5 ? ("customer" as const) : ("supplier" as const),
    name: fuzzField(rand),
    taxNumber: rand() < 0.7 ? token(rand, 11) : null,
  })
  return {
    virmanNo: `VRM-${token(rand, 6 + Math.floor(rand() * 20))}`,
    date: new Date("2026-09-24").toISOString(),
    amount: fuzzAmount(rand),
    description: rand() < 0.7 ? fuzzField(rand, 500) : null,
    company: {
      name: fuzzField(rand),
      taxNumber: token(rand, 10),
      address: fuzzField(rand, 260),
      city: fuzzField(rand, 40),
      phone: token(rand, 11),
    },
    legs: rand() < 0.8 ? [leg("CREDIT"), leg("DEBIT")] : [leg(rand() < 0.5 ? "DEBIT" : "CREDIT")],
  }
}

describe("virmanEtkiBelgeMetni", () => {
  it("hesabın kendi bakiyesini anlatır, birinci çoğul şahıs yok", () => {
    expect(virmanEtkiBelgeMetni("customer", "CREDIT")).toBe("Borç bakiyesi azalmıştır")
    expect(virmanEtkiBelgeMetni("customer", "DEBIT")).toBe("Borç bakiyesi artmıştır")
    expect(virmanEtkiBelgeMetni("supplier", "DEBIT")).toBe("Alacak bakiyesi azalmıştır")
    expect(virmanEtkiBelgeMetni("supplier", "CREDIT")).toBe("Alacak bakiyesi artmıştır")
  })
})

describe("Virman makbuzu PDF — kayma avı", () => {
  it("40 rastgele belge: taşma ve çakışma yok", async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 40; seed++) {
      const violations = checkPdf(await renderVirmanMakbuzPdf(buildData(rng(seed))))
      if (violations.length) {
        failures.push(`tohum ${seed}: ${violations.slice(0, 3).map((v) => v.message).join(" | ")}`)
      }
    }
    expect(failures, `yerleşim ihlali:\n${failures.join("\n")}`).toHaveLength(0)
  }, 180_000)
})
