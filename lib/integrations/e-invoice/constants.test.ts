import { describe, expect, it } from "vitest"
import { MYSOFT_PROD_URL, MYSOFT_TEST_URL, MysoftUrlError, resolveMysoftBaseUrl } from "./constants"

/**
 * Mysoft taban adresi yalnız iki bilinen ortamdan biri olabilir. Serbest URL kabul
 * edilseydi `test-mysoft` ucu firmanın KAYITLI (şifreli) Mysoft şifresini çözüp
 * gövdedeki `apiUrl`e POST ediyordu: yazma yetkili herhangi bir üye kendi sunucusunu
 * verip şifreyi alabilirdi (2026-09-18 taramasında bulundu).
 */
describe("resolveMysoftBaseUrl", () => {
  it("boş → güvenli TEST varsayılanı", () => {
    expect(resolveMysoftBaseUrl(undefined)).toBe(MYSOFT_TEST_URL)
    expect(resolveMysoftBaseUrl(null)).toBe(MYSOFT_TEST_URL)
    expect(resolveMysoftBaseUrl("   ")).toBe(MYSOFT_TEST_URL)
  })

  it("bilinen ortamları kanonik biçime indirger", () => {
    expect(resolveMysoftBaseUrl(MYSOFT_PROD_URL)).toBe(MYSOFT_PROD_URL)
    expect(resolveMysoftBaseUrl(`${MYSOFT_PROD_URL}/`)).toBe(MYSOFT_PROD_URL)
    expect(resolveMysoftBaseUrl(" https://EDOCUMENTAPI.mysoft.com.tr ")).toBe(MYSOFT_PROD_URL)
    expect(resolveMysoftBaseUrl(MYSOFT_TEST_URL)).toBe(MYSOFT_TEST_URL)
  })

  it("yabancı adresi REDDEDER — sessizce test ortamına düşmez", () => {
    for (const bad of [
      "https://attacker.example",
      "https://edocumentapi.mysoft.com.tr.evil.example",
      "http://edocumentapi.mysoft.com.tr", // yalnız https
      "http://127.0.0.1:3000",
      "edasdadas",
      "javascript:alert(1)",
    ]) {
      expect(() => resolveMysoftBaseUrl(bad), bad).toThrow(MysoftUrlError)
    }
  })
})
