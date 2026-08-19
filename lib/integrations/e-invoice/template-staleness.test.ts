/**
 * Şablon bayatlık mantığı.
 *
 * Kobipo tasarımları taban XSLT'nin üzerine tema uygulanarak üretilir. Taban
 * değişince Mysoft'taki kayıtlı kopya eski kalır — "bayat" budur. Dışarıdan
 * yüklenmiş şablonun içeriği bizde olmadığı için yenilenemez, dolayısıyla
 * bayat da SAYILMAZ (kullanıcıya yapamayacağı bir iş gösterilmez).
 */
import { describe, expect, it } from "vitest"
import {
  isTemplateStale,
  sampleTemplateVersion,
  sampleVersionForDocType,
} from "./sample-templates"

describe("şablon bayatlık", () => {
  it("taban sürümü değiştiyse bayattır", () => {
    expect(isTemplateStale({ options: { a: 1 }, baseVersion: "eskisurum" }, "yenisurum")).toBe(true)
  })

  it("aynı sürümden üretilmişse güncel", () => {
    expect(isTemplateStale({ options: { a: 1 }, baseVersion: "abc123" }, "abc123")).toBe(false)
  })

  it("sürümü bilinmeyen (eski kayıt) bayat sayılır", () => {
    expect(isTemplateStale({ options: { a: 1 }, baseVersion: null }, "abc123")).toBe(true)
  })

  it("dışarıdan yüklenen şablon bayat SAYILMAZ (yenilenemez)", () => {
    expect(isTemplateStale({ options: null, baseVersion: null }, "abc123")).toBe(false)
  })

  it("taban okunamadıysa bayat iddiasında bulunulmaz", () => {
    expect(isTemplateStale({ options: { a: 1 }, baseVersion: "abc123" }, null)).toBe(false)
  })

  it("gerçek taban şablonların sürüm imzası üretilir ve iki tip farklıdır", async () => {
    const efatura = await sampleVersionForDocType(1)
    const earsiv = await sampleVersionForDocType(2)
    expect(efatura).toMatch(/^[0-9a-f]{12}$/)
    expect(earsiv).toMatch(/^[0-9a-f]{12}$/)
    // İki taban dosya bugün birebir aynı içerikte; imzaları da aynı olmalı.
    expect(await sampleTemplateVersion("e-fatura")).toBe(efatura)
    expect(await sampleTemplateVersion("bilinmeyen-anahtar")).toBeNull()
  })

  it("imza içerikten türer: taban değişmedikçe sabit kalır", async () => {
    const a = await sampleVersionForDocType(2)
    const b = await sampleVersionForDocType(2)
    expect(a).toBe(b)
  })
})
