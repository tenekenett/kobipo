/**
 * Şablon otomatik tazeleme kararı.
 *
 * Kullanıcı hiçbir şey yapmadan Mysoft'taki tasarımın güncel kalması için
 * gönderim yolunda çalışan mantık. Yanlış karar iki yönde de pahalı:
 * gereksiz tazeleme her faturaya ek Mysoft çağrısı bindirir; eksik tazeleme
 * belgeyi eski görselle bastırır.
 */
import { describe, expect, it } from "vitest"
import { isRenderableXslt, planTemplateRefresh } from "./template-refresh"

describe("otomatik tazeleme kararı", () => {
  it("taban değiştiyse tazelenir", () => {
    expect(planTemplateRefresh({ options: { a: 1 }, baseVersion: "eski" }, "yeni")).toEqual({
      shouldRefresh: true,
      reason: "stale",
    })
  })

  it("güncelse dokunulmaz (her faturada boşuna yükleme yapılmaz)", () => {
    expect(planTemplateRefresh({ options: { a: 1 }, baseVersion: "abc" }, "abc")).toEqual({
      shouldRefresh: false,
      reason: "current",
    })
  })

  it("damgasız eski kayıt tazelenir", () => {
    expect(planTemplateRefresh({ options: { a: 1 }, baseVersion: null }, "abc").shouldRefresh).toBe(
      true,
    )
  })

  it("dışarıdan yüklenen şablona ASLA dokunulmaz", () => {
    expect(planTemplateRefresh({ options: null, baseVersion: null }, "abc")).toEqual({
      shouldRefresh: false,
      reason: "external",
    })
  })

  it("taban okunamadıysa tazeleme denenmez", () => {
    expect(planTemplateRefresh({ options: { a: 1 }, baseVersion: "abc" }, null)).toEqual({
      shouldRefresh: false,
      reason: "unknown-base",
    })
  })
})

describe("üretilen şablonun sağlık kontrolü", () => {
  const valid = `<?xml version="1.0"?><xsl:stylesheet xmlns:xsl="x">${"y".repeat(1200)}<xsl:template match="//n1:Invoice/cac:InvoiceLine"/></xsl:stylesheet>`

  it("geçerli XSLT kabul edilir", () => {
    expect(isRenderableXslt(valid)).toBe(true)
  })

  it("boş/kısa içerik reddedilir", () => {
    expect(isRenderableXslt("")).toBe(false)
    expect(isRenderableXslt("<xsl:stylesheet/>")).toBe(false)
  })

  it("stylesheet kökü yoksa reddedilir", () => {
    expect(isRenderableXslt("z".repeat(2000) + "cac:InvoiceLine")).toBe(false)
  })

  it("kalem tablosu kaybolduysa reddedilir (tema gövdeyi bozmuş)", () => {
    expect(isRenderableXslt(`<xsl:stylesheet>${"y".repeat(1200)}</xsl:stylesheet>`)).toBe(false)
  })
})
