import { describe, expect, it } from "vitest"
import { KDV_EXEMPTION_CODES, kdvExemption, kdvExemptionCodeError } from "./gib-exemption-codes"

/**
 * GİB e-Fatura paketi UBL-TR_Codelist.xml (v1.43, 14.09.2026'dan geçerli) — olduğu gibi.
 * GİB listeyi güncelleyince buradaki iki satır yeni paketten kopyalanır; test hangi
 * kodun seçiciye girmediğini söyler (scripts/istisna-kodu-kontrol.ts canlı ölçer).
 */
const GIB_TAX_EXEMPTION_REASON_CODE_TYPE =
  ",001,101,102,103,104,105,106,107,108,151,201,202,204,205,206,207,208,209,211,212,213,214,215,216,217,218,219,220,221,223,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,250,301,302,303,304,305,306,307,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,340,341,342,343,344,350,351,501,555,801,802,803,804,805,806,807,808,809,810,811,812,701,702,703,704,"
const GIB_YATIRIM_TESVIK = ",308,339,"
const GIB_ISTISNA_TYPE =
  ",001,101,102,103,104,105,106,107,108,201,202,204,205,206,207,208,209,211,212,213,214,215,216,217,218,219,220,221,223,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,250,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,350,501,"

const codes = (list: string) => list.split(",").filter(Boolean)

describe("KDV istisna kodları", () => {
  it("kodlar tekil, 3 haneli, adları dolu", () => {
    const all = KDV_EXEMPTION_CODES.map((c) => c.code)
    expect(new Set(all).size).toBe(all.length)
    for (const c of KDV_EXEMPTION_CODES) {
      expect(c.code).toMatch(/^\d{3}$/)
      expect(c.name.trim().length).toBeGreaterThan(3)
    }
  })

  it("seçici = GİB'in KDV (2xx/3xx) istisna kodları + 351", () => {
    const expected = codes(GIB_ISTISNA_TYPE)
      .filter((c) => /^[23]\d\d$/.test(c))
      .filter((c) => !codes(GIB_YATIRIM_TESVIK).includes(c))
      .concat("351")
      .sort()
    expect(KDV_EXEMPTION_CODES.map((c) => c.code).sort()).toEqual(expected)
  })

  it("GİB'in her kodu ya seçilebilir ya da açık bir nedenle dışarıda — sessiz boşluk yok", () => {
    for (const code of [...codes(GIB_TAX_EXEMPTION_REASON_CODE_TYPE), ...codes(GIB_YATIRIM_TESVIK)]) {
      const error = kdvExemptionCodeError(code)
      if (kdvExemption(code)) expect(error).toBeNull()
      else expect(error, code).not.toMatch(/GİB listesinde yok/)
    }
  })

  it("233 (v1.43, Mysoft listesinde yok) seçilebilir; 308/339 değil", () => {
    expect(kdvExemption("233")?.group).toBe("kismi")
    expect(kdvExemptionCodeError("308")).toContain("Yatırım teşvik")
    expect(kdvExemptionCodeError("339")).toContain("Yatırım teşvik")
  })

  it("başka fatura tipine ait kod nedeniyle reddedilir, bilinmeyen kod ayrı mesajla", () => {
    expect(kdvExemptionCodeError("701")).toContain("İhraç kayıtlı")
    expect(kdvExemptionCodeError("805")).toContain("Özel matrah")
    expect(kdvExemptionCodeError("101")).toContain("ÖTV")
    expect(kdvExemptionCodeError("999")).toContain("GİB listesinde yok")
  })

  it("eski editör etiketleri düzeltildi: 319 ve 325 sağlık/eğitim DEĞİL", () => {
    expect(kdvExemption("319")?.name).toContain("Araç Teslimleri")
    expect(kdvExemption("325")?.name).toContain("Yem Teslimleri")
  })
})
