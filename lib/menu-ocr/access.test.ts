import { describe, it, expect, afterEach } from "vitest"
import { menuTaramaAcikMi } from "./access"
import { fisTaramaAcikMi } from "@/lib/fis-ocr/access"

const eskiMenu = process.env.MENU_TARAMA_COMPANIES
const eskiFis = process.env.FIS_TARAMA_COMPANIES
afterEach(() => {
  if (eskiMenu === undefined) delete process.env.MENU_TARAMA_COMPANIES
  else process.env.MENU_TARAMA_COMPANIES = eskiMenu
  if (eskiFis === undefined) delete process.env.FIS_TARAMA_COMPANIES
  else process.env.FIS_TARAMA_COMPANIES = eskiFis
})

describe("menuTaramaAcikMi", () => {
  it("liste tanımsızken hiç kimseye açılmaz (fail-closed)", () => {
    delete process.env.MENU_TARAMA_COMPANIES
    expect(menuTaramaAcikMi({ id: "abc", slug: "kafe" })).toBe(false)
  })

  it("liste boşken de kapalıdır", () => {
    process.env.MENU_TARAMA_COMPANIES = "   "
    expect(menuTaramaAcikMi({ id: "abc", slug: "kafe" })).toBe(false)
  })

  it("slug ya da id ile eşleşir, harf/boşluk toleranslı", () => {
    process.env.MENU_TARAMA_COMPANIES = " Kafe-X , cmf3x9k2p0001abcd"
    expect(menuTaramaAcikMi({ id: "zzz", slug: "kafe-x" })).toBe(true)
    expect(menuTaramaAcikMi({ id: "cmf3x9k2p0001abcd", slug: "baska" })).toBe(true)
    expect(menuTaramaAcikMi({ id: "abc", slug: "baska" })).toBe(false)
    expect(menuTaramaAcikMi(null)).toBe(false)
  })

  // Karar G: iki liste AYRI havuz. Belge taramaya yazılan firma menü taramayı
  // açmaz — kafe müşterisi ile e-fatura müşterisi aynı küme değil.
  it("belge tarama listesi menü taramayı AÇMAZ", () => {
    delete process.env.MENU_TARAMA_COMPANIES
    process.env.FIS_TARAMA_COMPANIES = "kafe-x"
    expect(fisTaramaAcikMi({ slug: "kafe-x" })).toBe(true)
    expect(menuTaramaAcikMi({ slug: "kafe-x" })).toBe(false)
  })
})
