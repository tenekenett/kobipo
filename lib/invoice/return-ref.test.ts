import { describe, expect, it } from "vitest"
import { isGibDocumentNo, normalizeGibDocumentNo, returnRefError } from "./return-ref"

describe("GİB belge numarası", () => {
  it("3 harf + 13 rakam kabul edilir", () => {
    expect(isGibDocumentNo("ADM2026000000013")).toBe(true)
    expect(isGibDocumentNo("KKD2026000000328")).toBe(true)
  })

  it("Kobipo'nun İÇ numarası kabul EDİLMEZ — şematronu döndüren hata buydu", () => {
    expect(isGibDocumentNo("SAT-2026-0205")).toBe(false)
    expect(isGibDocumentNo("IAD-2026-0001")).toBe(false)
  })

  it("uzunluk ve biçim sınırları", () => {
    expect(isGibDocumentNo("ADM202600000001")).toBe(false) // 15 hane
    expect(isGibDocumentNo("ADM20260000000134")).toBe(false) // 17 hane
    expect(isGibDocumentNo("AD2026000000013X")).toBe(false) // 2 harf
    expect(isGibDocumentNo("")).toBe(false)
    expect(isGibDocumentNo(null)).toBe(false)
  })

  it("boşluk/tire temizlenir, küçük harf büyütülür", () => {
    expect(normalizeGibDocumentNo(" adm-2026 000000013 ")).toBe("ADM2026000000013")
    expect(isGibDocumentNo("adm 2026 0000 0001 3")).toBe(true)
  })
})

describe("returnRefError", () => {
  it("geçerli numarada hata yok", () => {
    expect(returnRefError("ADM2026000000013")).toBeNull()
  })

  it("boşta ve yanlış biçimde AYRI mesaj verir", () => {
    const bos = returnRefError("")
    const yanlis = returnRefError("SAT-2026-0205")
    expect(bos).toContain("girilmemiş")
    expect(yanlis).toContain("16 haneli")
    // Mesaj kullanıcıya ne yapacağını söylemeli: örnek numara içersin.
    expect(bos).toContain("ADM2026000000013")
    expect(yanlis).toContain("ADM2026000000013")
  })
})
