import { describe, expect, it } from "vitest"
import { designIdentity, matchForeignDesigns, type DesignCandidate, type DesignRow } from "./template-design"

const eren = { tenantVkn: "3531285187", username: "salih@hidroeren.com", baseUrl: "https://edocumentapi.mysoft.com.tr" }

describe("designIdentity — başka kayıttaki tasarım yalnız aynı Mysoft hesabından", () => {
  it("aynı VKN + kullanıcı + ortam eşleşir (büyük/küçük harf, sondaki / fark etmez)", () => {
    expect(designIdentity(eren)).toBe(
      designIdentity({ ...eren, username: "SALIH@hidroeren.com", baseUrl: "https://edocumentapi.mysoft.com.tr/" }),
    )
  })

  it("yalnız VKN'si aynı olan (kullanıcısı farklı/boş) kayıt eşleşmez", () => {
    expect(designIdentity({ ...eren, username: "baskasi@ornek.com" })).not.toBe(designIdentity(eren))
    expect(designIdentity({ ...eren, username: null })).toBeNull()
    expect(designIdentity({ ...eren, tenantVkn: "" })).toBeNull()
  })

  it("test ortamındaki aynı kullanıcı canlıyla eşleşmez", () => {
    expect(designIdentity({ ...eren, baseUrl: "https://edocumentapitest.mysoft.com.tr" })).not.toBe(designIdentity(eren))
  })
})

describe("matchForeignDesigns", () => {
  const row = (over: Partial<DesignRow>): DesignRow => ({
    id: "satir",
    companyId: "eren-kopya",
    eDocumentType: 2,
    xsltName: "eforkliftearsiv",
    hidden: false,
    hasDesign: false,
    ...over,
  })
  const design = (over: Partial<DesignCandidate>): DesignCandidate => ({
    id: "tasarim",
    companyId: "eren-ana",
    eDocumentType: 2,
    xsltName: "eforkliftearsiv",
    updatedAt: new Date("2026-09-03"),
    ...over,
  })
  const identities: Record<string, string | null> = {
    "eren-kopya": designIdentity(eren),
    "eren-ana": designIdentity(eren),
    "eren-sube": designIdentity(eren),
    // Aynı VKN'yi girmiş ama Mysoft kullanıcısı başka olan kayıt.
    yabanci: designIdentity({ ...eren, username: "yabanci@ornek.com" }),
    kimliksiz: null,
  }
  const identityOf = (id: string) => identities[id]

  it("aynı Mysoft hesabındaki kayıtta aynı ad + tiple yapılmış tasarım eşleşir", () => {
    expect(matchForeignDesigns([row({})], [design({})], identityOf).get("satir")).toBe("tasarim")
  })

  it("aynı ad birden çok kayıtta tasarlandıysa en son güncellenen", () => {
    const m = matchForeignDesigns(
      [row({})],
      [design({ id: "eski" }), design({ id: "yeni", companyId: "eren-sube", updatedAt: new Date("2026-09-20") })],
      identityOf,
    )
    expect(m.get("satir")).toBe("yeni")
  })

  it("Mysoft kimliği farklı (yalnız VKN'si aynı) kaydın tasarımı ALINMAZ", () => {
    expect(matchForeignDesigns([row({})], [design({ companyId: "yabanci" })], identityOf).size).toBe(0)
    expect(matchForeignDesigns([row({ companyId: "kimliksiz" })], [design({})], identityOf).size).toBe(0)
  })

  it("belge tipi ya da ad farklıysa, satırın kendi tasarımı varsa ya da satır gizliyse eşleşmez", () => {
    expect(matchForeignDesigns([row({})], [design({ eDocumentType: 1 })], identityOf).size).toBe(0)
    expect(matchForeignDesigns([row({})], [design({ xsltName: "baska" })], identityOf).size).toBe(0)
    expect(matchForeignDesigns([row({ hasDesign: true })], [design({})], identityOf).size).toBe(0)
    expect(matchForeignDesigns([row({ hidden: true })], [design({})], identityOf).size).toBe(0)
  })

  it("firmanın kendi satırı kendi tasarımı sayılmaz", () => {
    expect(matchForeignDesigns([row({})], [design({ companyId: "eren-kopya" })], identityOf).size).toBe(0)
  })
})
