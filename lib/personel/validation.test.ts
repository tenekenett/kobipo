import { describe, expect, it } from "vitest"
import { isValidTcKimlik, normalizeExternalFileUrl } from "./validation"

describe("isValidTcKimlik", () => {
  it("resmi algoritmayı uygular", () => {
    expect(isValidTcKimlik("10000000146")).toBe(true)
    expect(isValidTcKimlik("10000000147")).toBe(false)
    expect(isValidTcKimlik("00000000000")).toBe(false)
    expect(isValidTcKimlik("abc")).toBe(false)
  })
})

describe("normalizeExternalFileUrl", () => {
  it("boş → null (bağlantı yok)", () => {
    expect(normalizeExternalFileUrl("")).toBeNull()
    expect(normalizeExternalFileUrl("   ")).toBeNull()
    expect(normalizeExternalFileUrl(undefined)).toBeNull()
    expect(normalizeExternalFileUrl(null)).toBeNull()
  })

  it("mutlak http(s) adresi kabul eder", () => {
    expect(normalizeExternalFileUrl(" https://drive.example/x.pdf ")).toBe("https://drive.example/x.pdf")
    expect(normalizeExternalFileUrl("http://intranet/belge")).toBe("http://intranet/belge")
  })

  it("geçersiz/şemasız/tehlikeli adresi REDDEDER (false), null'a düşürmez", () => {
    for (const bad of ["edasdadas", "www.example.com/x.pdf", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd"]) {
      expect(normalizeExternalFileUrl(bad), bad).toBe(false)
    }
  })
})
