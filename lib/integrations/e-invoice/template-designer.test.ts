/**
 * Şablon tasarımcısının taban XSLT'ye dokunma biçimi.
 *
 * Kritik nokta: serbest not (banka/IBAN) faturanın AÇIKLAMA kutusunun içine
 * girer — sayfanın en altına değil. Kutu yer tutucusu bulunamayan yabancı bir
 * tabanda not kaybolmamalı, eski davranışa (sayfa sonu) düşülmelidir.
 */
import { describe, expect, it } from "vitest"
import { applyThemeToXslt, DEFAULT_DESIGN_OPTIONS } from "./template-designer"

const withNote = (footerNote: string) => ({ ...DEFAULT_DESIGN_OPTIONS, footerNote })

/** Taban şablonun ilgili iskeleti: stil bloğu + açıklama kutusu + gövde sonu. */
const BASE =
  `<?xml version="1.0"?><xsl:stylesheet xmlns:xsl="x"><xsl:template match="/"><html>` +
  `<head><style>body{margin:0}</style></head><body>` +
  `<table id="notesTable" width="800"><tbody><tr><td id="notesTableTd">FATURA NOTU` +
  `<span id="addedNote" /><span id="PaymentForNote" /></td></tr></tbody></table>` +
  `<span id="bankTable" /></body></html></xsl:template></xsl:stylesheet>`

describe("tasarımın taban XSLT'ye uygulanması", () => {
  it("tema CSS'i mevcut stil bloğunun sonuna yazılır (cascade'de kazanır)", () => {
    const out = applyThemeToXslt(BASE, DEFAULT_DESIGN_OPTIONS)
    const css = out.indexOf("Kobipo Şablon Tasarımcısı")
    expect(css).toBeGreaterThan(out.indexOf("body{margin:0}"))
    expect(css).toBeLessThan(out.indexOf("</style>"))
  })

  it("not, açıklama kutusunun İÇİNE (addedNote yer tutucusuna) basılır", () => {
    const out = applyThemeToXslt(BASE, withNote("AKBANK — IBAN: TR80"))
    expect(out).toContain('<span id="addedNote" style="display:block;">')
    expect(out).not.toContain('<span id="addedNote" />')
    // Metin kutunun kapanışından önce, yani hücrenin içinde olmalı.
    const note = out.indexOf("AKBANK")
    expect(note).toBeGreaterThan(out.indexOf('id="notesTableTd"'))
    expect(note).toBeLessThan(out.indexOf("</td>"))
  })

  it("satır sonları <br/> olur, XML özel karakterleri kaçışlanır", () => {
    const out = applyThemeToXslt(BASE, withNote("Banka & Co\n<TR12>"))
    expect(out).toContain("Banka &amp; Co<br/>&lt;TR12&gt;")
  })

  it("nottaki `$&` replace kalıbı sayılmaz, olduğu gibi çıkar", () => {
    const out = applyThemeToXslt(BASE, withNote("Hesap $& $1 no"))
    expect(out).toContain("Hesap $&amp; $1 no")
  })

  it("not boşsa taban hiç kirletilmez", () => {
    const out = applyThemeToXslt(BASE, withNote("   \n  "))
    expect(out).toContain('<span id="addedNote" />')
  })

  it("yer tutucusu olmayan tabanda not sayfa sonuna düşer (kaybolmaz)", () => {
    const foreign = BASE.replace('<span id="addedNote" />', "")
    const out = applyThemeToXslt(foreign, withNote("AKBANK — IBAN: TR80"))
    const note = out.indexOf("AKBANK")
    expect(note).toBeGreaterThan(0)
    expect(note).toBeLessThan(out.indexOf("</body>"))
  })
})
