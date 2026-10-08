import { describe, expect, it } from "vitest"
import { logoDocTypeFor, pickLogoSource, pickLogoTemplate, type LogoCandidate } from "./logo"
import { logoDrawSize } from "@/lib/pdf/documents/fatura-document"
import { mm } from "@/lib/pdf/doc/theme"

const c = (over: Partial<LogoCandidate>): LogoCandidate => ({
  id: "t",
  companyId: "firma",
  eDocumentType: 1,
  isActive: false,
  hidden: false,
  hasLogo: true,
  updatedAt: new Date("2026-08-01"),
  ...over,
})

describe("pickLogoTemplate", () => {
  it("aktif şablonun logosu, daha yeni pasif şablonun önüne geçer", () => {
    const chosen = pickLogoTemplate([
      c({ id: "yeni-pasif", updatedAt: new Date("2026-09-30") }),
      c({ id: "aktif", isActive: true }),
    ])
    expect(chosen?.id).toBe("aktif")
  })

  it("aktif şablonda logo yoksa en son güncellenen logolu şablon", () => {
    const chosen = pickLogoTemplate([
      c({ id: "aktif-logosuz", isActive: true, hasLogo: false }),
      c({ id: "eski", updatedAt: new Date("2026-07-01") }),
      c({ id: "yeni", updatedAt: new Date("2026-08-23") }),
    ])
    expect(chosen?.id).toBe("yeni")
  })

  it("gizlenen (silinen) şablonun logosu kullanılmaz", () => {
    expect(pickLogoTemplate([c({ id: "gizli", isActive: true, hidden: true })])).toBeNull()
  })

  it("iki aktif şablondan belgenin türüne uyan seçilir (resmî hâlinde basılacak logo)", () => {
    const sablonlar = [
      c({ id: "efatura", eDocumentType: 1, isActive: true, updatedAt: new Date("2026-09-30") }),
      c({ id: "earsiv", eDocumentType: 2, isActive: true, updatedAt: new Date("2026-08-01") }),
    ]
    expect(pickLogoTemplate(sablonlar, 2)?.id).toBe("earsiv")
    expect(pickLogoTemplate(sablonlar, 1)?.id).toBe("efatura")
    // Manuel fatura: tercih yok, en yeni.
    expect(pickLogoTemplate(sablonlar, null)?.id).toBe("efatura")
  })
})

describe("logoDocTypeFor", () => {
  it("e-Fatura 1, e-Arşiv 2, Manuel tercihsiz", () => {
    expect(logoDocTypeFor("E_INVOICE")).toBe(1)
    expect(logoDocTypeFor("E_ARCHIVE")).toBe(2)
    expect(logoDocTypeFor("MANUAL")).toBeNull()
  })
})

describe("pickLogoSource", () => {
  const base = { companyId: "firma", parentCompanyId: null, templates: [], receiptLogoCompanyIds: [] }

  it("şablon logosu fiş logosunun önüne geçer", () => {
    expect(
      pickLogoSource({ ...base, receiptLogoCompanyIds: ["firma"], templates: [c({ id: "aktif", isActive: true })] }),
    ).toEqual({ kind: "template", companyId: "firma", templateId: "aktif" })
  })

  it("şablonda logo yoksa fiş tasarımının logosu (e-Dönüşümsüz firma)", () => {
    expect(pickLogoSource({ ...base, receiptLogoCompanyIds: ["firma"] })).toEqual({ kind: "receipt", companyId: "firma" })
  })

  it("şubenin kendi logosu yoksa ana firmanınki", () => {
    expect(
      pickLogoSource({
        ...base,
        companyId: "sube",
        parentCompanyId: "ana",
        templates: [c({ id: "ana-sablon", companyId: "ana", isActive: true })],
      }),
    ).toEqual({ kind: "template", companyId: "ana", templateId: "ana-sablon" })
  })

  it("şubenin fiş logosu ana firmanın şablon logosundan önce gelir", () => {
    expect(
      pickLogoSource({
        ...base,
        companyId: "sube",
        parentCompanyId: "ana",
        receiptLogoCompanyIds: ["sube"],
        templates: [c({ id: "ana-sablon", companyId: "ana", isActive: true })],
      }),
    ).toEqual({ kind: "receipt", companyId: "sube" })
  })

  it("tasarımı başka kayıtta duran şablonda logo o kayıttaki satırdan okunur", () => {
    expect(
      pickLogoSource({
        ...base,
        docType: 2,
        templates: [
          c({ id: "efatura", eDocumentType: 1, isActive: true, designTemplateId: "kardes-efatura" }),
          c({ id: "earsiv", eDocumentType: 2, isActive: true, designTemplateId: "kardes-earsiv" }),
        ],
      }),
    ).toEqual({ kind: "template", companyId: "firma", templateId: "kardes-earsiv" })
  })

  it("başka firmanın şablonu seçilmez; logo yoksa null", () => {
    expect(pickLogoSource({ ...base, templates: [c({ companyId: "baska" })] })).toBeNull()
  })
})

describe("logoDrawSize", () => {
  it("geniş logo kolon genişliğine, yüksek logo yükseklik sınırına sığar; oran korunur", () => {
    const wide = logoDrawSize({ dataUri: "", pixelWidth: 1000, pixelHeight: 100 })
    expect(wide.width).toBeCloseTo(mm(62), 1)
    expect(wide.width / wide.height).toBeCloseTo(10, 5)

    const tall = logoDrawSize({ dataUri: "", pixelWidth: 100, pixelHeight: 400 })
    expect(tall.height).toBeCloseTo(mm(24), 1)
    expect(tall.width / tall.height).toBeCloseTo(0.25, 5)
  })

  it("Kobipo logosu (firmanın logosu yok) daha dar kutuda basılır", () => {
    const firma = logoDrawSize({ dataUri: "", pixelWidth: 774, pixelHeight: 267 })
    const kobipo = logoDrawSize({ dataUri: "", pixelWidth: 774, pixelHeight: 267, kobipo: true })
    expect(kobipo.width).toBeCloseTo(mm(40), 1)
    expect(kobipo.width).toBeLessThan(firma.width)
  })
})
