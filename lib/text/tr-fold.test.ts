import { describe, expect, it } from "vitest"
import { TR_FOLD_FROM, TR_FOLD_TO, trFold, trIncludes, trMatcher } from "./tr-fold"

describe("trFold", () => {
  it("harf tablosu SQL translate() ile aynı uzunlukta", () => {
    // Uzunluklar ayrışırsa Postgres fazlalık harfleri SİLER; JS tarafı silmez.
    expect(TR_FOLD_FROM.length).toBe(TR_FOLD_TO.length)
    expect(new Set(TR_FOLD_FROM).size).toBe(TR_FOLD_FROM.length)
  })

  it("I/ı/İ/i dördü de aynı anahtara iner", () => {
    const beklenen = "isik"
    expect(trFold("IŞIK")).toBe(beklenen)
    expect(trFold("ışık")).toBe(beklenen)
    expect(trFold("Işık")).toBe(beklenen)
    expect(trFold("isik")).toBe(beklenen)
    expect(trFold("IŞIk")).toBe(beklenen)
  })

  it("İstanbul = istanbul = ISTANBUL", () => {
    expect(trFold("İstanbul")).toBe("istanbul")
    expect(trFold("istanbul")).toBe("istanbul")
    expect(trFold("ISTANBUL")).toBe("istanbul")
  })

  it("aksanlı harfleri sadeleştirir", () => {
    expect(trFold("Şişli")).toBe("sisli")
    expect(trFold("Ğğ Üü Öö Çç")).toBe("gg uu oo cc")
    expect(trFold("Hâlâ Îî Ûû")).toBe("hala ii uu")
  })

  it("İ'yi toLowerCase'e sokmaz (birleşik nokta üretmez)", () => {
    // "İ".toLowerCase() → "i̇"; anahtarda U+0307 kalırsa hiçbir şey eşleşmez.
    expect(trFold("İ")).toBe("i")
    expect(trFold("İ")).not.toContain("̇")
  })

  it("boş, null ve undefined → ''", () => {
    expect(trFold("")).toBe("")
    expect(trFold(null)).toBe("")
    expect(trFold(undefined)).toBe("")
    expect(trFold("   ")).toBe("")
  })

  it("baştaki/sondaki boşluğu atar, içerideki boşluğu korur", () => {
    expect(trFold("  Ali Veli  ")).toBe("ali veli")
  })

  it("sayı da kabul eder", () => {
    expect(trFold(1234)).toBe("1234")
  })

  it("Türkçe olmayan metni bozmaz", () => {
    expect(trFold("ACME Ltd. Şti.")).toBe("acme ltd. sti.")
    expect(trFold("TR12-345/A")).toBe("tr12-345/a")
  })
})

describe("trIncludes", () => {
  it("aksan ve büyük/küçük harf duyarsız alt dize arar", () => {
    expect(trIncludes("Şişli Şubesi", "sisli")).toBe(true)
    expect(trIncludes("IŞIK GIDA A.Ş.", "ışık")).toBe(true)
    expect(trIncludes("IŞIK GIDA A.Ş.", "gıda")).toBe(true)
    expect(trIncludes("IŞIK GIDA A.Ş.", "ayşe")).toBe(false)
  })

  it("boş terim her şeyi eşler, boş alan hiçbir şeyi", () => {
    expect(trIncludes("Şişli", "")).toBe(true)
    expect(trIncludes(null, "")).toBe(true)
    expect(trIncludes(null, "a")).toBe(false)
  })
})

describe("trMatcher", () => {
  it("alanlardan herhangi biri eşleşirse true", () => {
    const eslesir = trMatcher("SEKER")
    expect(eslesir("Şeker", "URN-1", null)).toBe(true)
    expect(eslesir(null, "seker-kodu")).toBe(true)
    expect(eslesir("Tuz", "URN-2", 999)).toBe(false)
  })

  it("boş terim tüm satırları geçirir", () => {
    const eslesir = trMatcher("  ")
    expect(eslesir(null, undefined)).toBe(true)
  })
})
