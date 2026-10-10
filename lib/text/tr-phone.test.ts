import { describe, expect, it } from "vitest"
import {
  displayTrPhone,
  formatTrPhone,
  isValidTrPhone,
  normalizeTrPhone,
  trPhoneDigits,
} from "./tr-phone"

describe("trPhoneDigits", () => {
  it("canlıda görülen biçimlerin hepsi aynı diziye iner (2026-10-10 ölçümü)", () => {
    expect(trPhoneDigits("05321234567")).toBe("05321234567")
    expect(trPhoneDigits("5321234567")).toBe("05321234567")
    expect(trPhoneDigits("+90 532 123 4567")).toBe("05321234567")
    expect(trPhoneDigits("0090 532 123 45 67")).toBe("05321234567")
    expect(trPhoneDigits("905321234567")).toBe("05321234567")
    expect(trPhoneDigits("(0532) 123-45-67")).toBe("05321234567")
  })

  it("yazılırken yarım numarayı bozmaz", () => {
    expect(trPhoneDigits("")).toBe("")
    expect(trPhoneDigits("0")).toBe("0")
    expect(trPhoneDigits("5")).toBe("05")
    expect(trPhoneDigits("053")).toBe("053")
    // Ülke kodu yazılıyor: sonraki rakamda düşer.
    expect(trPhoneDigits("+9")).toBe("9")
    expect(trPhoneDigits("+90")).toBe("90")
    expect(trPhoneDigits("+905")).toBe("05")
    expect(trPhoneDigits("009")).toBe("009")
    expect(trPhoneDigits("0090")).toBe("0090")
    expect(trPhoneDigits("00905")).toBe("05")
  })

  it("11 haneden fazlasını kırpar", () => {
    expect(trPhoneDigits("053212345678999")).toBe("05321234567")
  })
})

describe("formatTrPhone", () => {
  it("4-3-2-2 gruplar", () => {
    expect(formatTrPhone("05321234567")).toBe("0532 123 45 67")
    expect(formatTrPhone("+90 532 123 4567")).toBe("0532 123 45 67")
    expect(formatTrPhone("0532123")).toBe("0532 123")
    expect(formatTrPhone("05321")).toBe("0532 1")
    expect(formatTrPhone("")).toBe("")
  })

  it("maskeli değer yeniden maskelenince değişmez (her tuşta çağrılıyor)", () => {
    const once = formatTrPhone("05321234567")
    expect(formatTrPhone(once)).toBe(once)
  })
})

describe("isValidTrPhone / normalizeTrPhone", () => {
  it("GSM, sabit hat ve 0850 geçer", () => {
    expect(normalizeTrPhone("0532 123 45 67")).toBe("05321234567")
    expect(normalizeTrPhone("0212 123 45 67")).toBe("02121234567")
    expect(normalizeTrPhone("0850 123 45 67")).toBe("08501234567")
    expect(isValidTrPhone("5321234567")).toBe(true)
  })

  it("eksik hane ve Türkiye'de olmayan alan kodu geçmez", () => {
    expect(normalizeTrPhone("0532 123 45")).toBeNull()
    expect(normalizeTrPhone("0000 000 00 00")).toBeNull()
    expect(normalizeTrPhone("0123 456 78 90")).toBeNull()
    expect(normalizeTrPhone("0932 123 45 67")).toBeNull()
    expect(normalizeTrPhone("")).toBeNull()
    expect(normalizeTrPhone(null)).toBeNull()
  })
})

describe("displayTrPhone", () => {
  it("standarda uyanı maskeler, eski serbest kaydı olduğu gibi bırakır", () => {
    expect(displayTrPhone("05321234567")).toBe("0532 123 45 67")
    expect(displayTrPhone("12345")).toBe("12345")
    expect(displayTrPhone(null)).toBe("")
  })
})
