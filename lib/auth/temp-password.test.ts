import { describe, expect, it } from "vitest"
import { generateTempPassword, TEMP_PASSWORD_LENGTH } from "@/lib/auth/temp-password"

describe("generateTempPassword", () => {
  it("her zaman istenen uzunlukta döner (Math.random'ın 7 karakterlik kısa çıktısı yok)", () => {
    for (let i = 0; i < 200; i++) expect(generateTempPassword()).toHaveLength(TEMP_PASSWORD_LENGTH)
    expect(generateTempPassword(8)).toHaveLength(8)
  })

  it("karışan karakterleri (0 O 1 l I) kullanmaz", () => {
    const all = Array.from({ length: 200 }, () => generateTempPassword()).join("")
    expect(all).not.toMatch(/[0O1lI]/)
  })

  it("ardışık çağrılar farklı sonuç verir", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateTempPassword()))
    expect(set.size).toBe(100)
  })
})
