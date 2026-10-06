import { describe, expect, it } from "vitest"
import { parseScanMultiplier } from "./scan-multiplier"

describe("parseScanMultiplier — tezgâhta 3*barkod", () => {
  it("tam sayı ve ondalık çarpan", () => {
    expect(parseScanMultiplier("3*8690123456789")).toEqual({ quantity: 3, term: "8690123456789" })
    expect(parseScanMultiplier("2,5*hortum")).toEqual({ quantity: 2.5, term: "hortum" })
    expect(parseScanMultiplier(" 4 * soket ")).toEqual({ quantity: 4, term: "soket " })
  })

  it("henüz okutulmamış çarpan: miktar var, aranan boş", () => {
    expect(parseScanMultiplier("3*")).toEqual({ quantity: 3, term: "" })
  })

  it("çarpan yoksa metin aynen aranır — boyut ayracı 'x' çarpan SAYILMAZ", () => {
    expect(parseScanMultiplier("18x20 rekor")).toEqual({ quantity: null, term: "18x20 rekor" })
    expect(parseScanMultiplier("8690123456789")).toEqual({ quantity: null, term: "8690123456789" })
    expect(parseScanMultiplier("hortum*2")).toEqual({ quantity: null, term: "hortum*2" })
  })

  it("sıfır çarpan miktar vermez", () => {
    expect(parseScanMultiplier("0*soket")).toEqual({ quantity: null, term: "soket" })
  })
})
