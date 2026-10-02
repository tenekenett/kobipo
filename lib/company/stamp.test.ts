import { describe, expect, it } from "vitest"
import {
  STAMP_MAX_HEIGHT_MM,
  clampStampWidthMm,
  pickStampSource,
  pickStampTemplate,
  settingsStampBox,
  templateBoxFromSettings,
  templateStampBox,
  type StampCandidate,
} from "./stamp"
import { stampDrawSize } from "@/lib/pdf/documents/makbuz-document"
import { mm } from "@/lib/pdf/doc/theme"

const c = (over: Partial<StampCandidate>): StampCandidate => ({
  id: "t",
  companyId: "firma",
  isActive: false,
  hidden: false,
  hasStamp: true,
  updatedAt: new Date("2026-08-01"),
  ...over,
})

describe("pickStampTemplate", () => {
  it("aktif şablonun kaşesi, daha yeni pasif şablonun önüne geçer", () => {
    const chosen = pickStampTemplate([
      c({ id: "yeni-pasif", updatedAt: new Date("2026-09-30") }),
      c({ id: "aktif", isActive: true, updatedAt: new Date("2026-08-01") }),
    ])
    expect(chosen?.id).toBe("aktif")
  })

  it("aktif şablonda kaşe yoksa en son güncellenen kaşeli şablon", () => {
    const chosen = pickStampTemplate([
      c({ id: "aktif-kasesiz", isActive: true, hasStamp: false }),
      c({ id: "eski", updatedAt: new Date("2026-07-01") }),
      c({ id: "yeni", updatedAt: new Date("2026-08-23") }),
    ])
    expect(chosen?.id).toBe("yeni")
  })

  it("gizlenen (silinen) şablonun kaşesi kullanılmaz", () => {
    expect(pickStampTemplate([c({ id: "gizli", isActive: true, hidden: true })])).toBeNull()
  })
})

describe("pickStampSource", () => {
  const base = { companyId: "firma", parentCompanyId: null, settingsCompanyIds: [], templates: [] }

  it("ayarlardaki kaşe şablon kaşesinin önüne geçer", () => {
    expect(
      pickStampSource({ ...base, settingsCompanyIds: ["firma"], templates: [c({ id: "aktif", isActive: true })] }),
    ).toEqual({ kind: "settings", companyId: "firma" })
  })

  it("ayarlarda kaşe yoksa şablonun kaşesi", () => {
    expect(pickStampSource({ ...base, templates: [c({ id: "aktif", isActive: true })] })).toEqual({
      kind: "template",
      companyId: "firma",
      templateId: "aktif",
    })
  })

  it("şubenin kendi şablon kaşesi, ana firmanın ayar kaşesinden önce gelir", () => {
    expect(
      pickStampSource({
        ...base,
        parentCompanyId: "ana",
        settingsCompanyIds: ["ana"],
        templates: [c({ id: "sube-sablonu" })],
      }),
    ).toEqual({ kind: "template", companyId: "firma", templateId: "sube-sablonu" })
  })

  it("şubenin hiç kaşesi yoksa ana firmanın ayar kaşesi, o da yoksa şablon kaşesi", () => {
    expect(pickStampSource({ ...base, parentCompanyId: "ana", settingsCompanyIds: ["ana"] })).toEqual({
      kind: "settings",
      companyId: "ana",
    })
    expect(
      pickStampSource({ ...base, parentCompanyId: "ana", templates: [c({ id: "ana-sablonu", companyId: "ana" })] }),
    ).toEqual({ kind: "template", companyId: "ana", templateId: "ana-sablonu" })
  })

  it("başka firmanın kaşesi seçilmez; kaşe yoksa null", () => {
    expect(pickStampSource({ ...base, settingsCompanyIds: ["baska"], templates: [c({ companyId: "baska" })] })).toBeNull()
    expect(pickStampSource(base)).toBeNull()
  })
})

describe("basım ölçüsü", () => {
  it("genişlik 25–60 mm aralığına çekilir, geçersizde 40", () => {
    expect(clampStampWidthMm(10)).toBe(25)
    expect(clampStampWidthMm(99)).toBe(60)
    expect(clampStampWidthMm("abc")).toBe(40)
    expect(clampStampWidthMm(45.4)).toBe(45)
  })

  it("şablon kutusuna en-boy oranı korunarak sığar (100 px kutu = 75 pt)", () => {
    const stamp = { dataUri: "", pixelWidth: 400, pixelHeight: 200, ...templateStampBox(100, 100) }
    expect(stampDrawSize(stamp, 500)).toEqual({ width: 75, height: 37.5 })
  })

  it("ayar kaşesi seçilen genişlikte basılır", () => {
    const stamp = { dataUri: "", pixelWidth: 400, pixelHeight: 200, ...settingsStampBox(40) }
    expect(stampDrawSize(stamp, 500).width).toBeCloseTo(mm(40), 1)
  })

  it("sütundan ve yükseklik sınırından taşmaz", () => {
    const tall = { dataUri: "", pixelWidth: 100, pixelHeight: 1000, ...settingsStampBox(60) }
    const size = stampDrawSize(tall, 50)
    expect(size.width).toBeLessThanOrEqual(50)
    expect(size.height).toBeLessThanOrEqual(mm(STAMP_MAX_HEIGHT_MM))
  })
})

describe("templateBoxFromSettings (ayar kaşesi → şablon tasarımcısı)", () => {
  it("40 mm genişlik ≈ 151 px, yükseklik görselin oranından", () => {
    expect(templateBoxFromSettings(40, 400, 200)).toEqual({ stampWidth: 151, stampHeight: 76 })
  })

  it("uzun görsel 240 px'e oran korunarak sığar", () => {
    expect(templateBoxFromSettings(60, 100, 300)).toEqual({ stampWidth: 80, stampHeight: 240 })
  })

  it("çok yassı görselde yükseklik 40 px'in altına inmez", () => {
    expect(templateBoxFromSettings(40, 1000, 50).stampHeight).toBe(40)
  })
})
