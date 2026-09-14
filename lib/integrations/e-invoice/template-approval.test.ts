/**
 * Mysoft şablon onayı — e-Arşiv yalnız ONAYLI dizaynla basılır.
 *
 * Yanlış karar pahalı: yanlış yedek seçimi belgeyi kullanıcının hiç seçmediği bir
 * dizaynla bastırır; yedek bulamamak ise faturayı Mysoft portalına yollayan ham
 * mesajla keser (Eren Forklift, 9–14 Eylül 2026: 11 gün e-Arşiv kesilemedi).
 */
import { describe, expect, it } from "vitest"
import {
  isTemplateNotFoundError,
  pickApprovedXslt,
  templateNotFoundMessage,
  templateStatus,
  type TenantXsltEntry,
} from "./template-approval"

const REYPO: TenantXsltEntry[] = [
  { xsltName: "e-fatura", isApproved: true, isDefault: true, eDocumentTypeEnumText: "E-Fatura", approvedDate: "2026-06-04" },
  { xsltName: "kurumsalmaviefatura", isApproved: true, isDefault: false, eDocumentTypeEnumText: "E-Fatura", approvedDate: "2026-08-26" },
  { xsltName: "E-Arşiv — Örnek Şablon", isApproved: false, isDefault: false, eDocumentTypeEnumText: "E-Arşiv Fatura", approvedDate: null },
  { xsltName: "dendir", isApproved: false, isDefault: false, eDocumentTypeEnumText: "E-Arşiv Fatura", approvedDate: null },
  { xsltName: "e-arşiv-kaşeli", isApproved: true, isDefault: false, eDocumentTypeEnumText: "E-Arşiv Fatura", approvedDate: "2026-08-31" },
]

describe("Mysoft 'belge görseli bulunamadı' reddi", () => {
  it("ham mesajı tanır", () => {
    expect(
      isTemplateNotFoundError(
        "E-Arşiv Fatura belge tipine ait uygun belge görseli bulunamamıştır. Portal üzerinde Firma Bilgileri > Belge Ayarları > Şablonlar tanımında belge görseli oluşturabilirsiniz.",
      ),
    ).toBe(true)
  })
  it("başka redleri karıştırmaz", () => {
    expect(isTemplateNotFoundError("Belge için uygun numaratör bulunamamıştır.")).toBe(false)
    expect(isTemplateNotFoundError(undefined)).toBe(false)
  })
})

describe("şablon durumu", () => {
  it("onaylı / bekleyen / yok ayrımı", () => {
    expect(templateStatus(REYPO, 2, "e-arşiv-kaşeli")).toBe("approved")
    expect(templateStatus(REYPO, 2, "dendir")).toBe("pending")
    expect(templateStatus(REYPO, 2, "eforkliftearsiv")).toBe("missing")
    expect(templateStatus(REYPO, 2, null)).toBe("missing")
  })
  it("belge tipi karışmaz: e-Fatura şablonu e-Arşiv için 'yok'tur", () => {
    expect(templateStatus(REYPO, 2, "kurumsalmaviefatura")).toBe("missing")
    expect(templateStatus(REYPO, 1, "kurumsalmaviefatura")).toBe("approved")
  })
  it("ad karşılaştırması Türkçe büyük/küçük duyarsız", () => {
    expect(templateStatus(REYPO, 2, "E-ARŞİV-KAŞELİ")).toBe("approved")
  })
})

describe("onaylı yedek seçimi", () => {
  it("yalnız onaylı ve aynı tipteki şablonlar aday", () => {
    expect(pickApprovedXslt(REYPO, 2)).toBe("e-arşiv-kaşeli")
  })
  it("istenen ad dışlanır (o zaten reddedildi)", () => {
    expect(pickApprovedXslt(REYPO, 2, "e-arşiv-kaşeli")).toBeNull()
  })
  it("Mysoft varsayılanı öne geçer, sonra en son onaylanan", () => {
    const list: TenantXsltEntry[] = [
      { xsltName: "yeni", isApproved: true, isDefault: false, approvedDate: "2026-09-01", eDocumentTypeEnumText: "E-Arşiv Fatura" },
      { xsltName: "varsayilan", isApproved: true, isDefault: true, approvedDate: "2026-06-01", eDocumentTypeEnumText: "E-Arşiv Fatura" },
      { xsltName: "eski", isApproved: true, isDefault: false, approvedDate: "2026-07-01", eDocumentTypeEnumText: "E-Arşiv Fatura" },
    ]
    expect(pickApprovedXslt(list, 2)).toBe("varsayilan")
    expect(pickApprovedXslt(list, 2, "varsayilan")).toBe("yeni")
  })
  it("tip metni boşsa şablon elenmez (Mysoft tipe göre süzmüş olabilir)", () => {
    expect(pickApprovedXslt([{ xsltName: "x", isApproved: true }], 2)).toBe("x")
  })
  it("hiç onaylı yoksa null", () => {
    expect(pickApprovedXslt([{ xsltName: "x", isApproved: false }], 2)).toBeNull()
  })
})

describe("kullanıcı mesajı", () => {
  it("onay bekleyen şablonu adıyla söyler", () => {
    const m = templateNotFoundMessage({ xsltName: "eforkliftearsiv", status: "pending" })
    expect(m).toContain('"eforkliftearsiv"')
    expect(m).toContain("ONAY BEKLİYOR")
    expect(m).toContain("Belge Şablonları")
  })
  it("silinmiş/reddedilmiş şablonu ayırt eder", () => {
    expect(templateNotFoundMessage({ xsltName: "x", status: "missing" })).toContain("bulunamadı")
  })
  it("aktif şablon yoksa bunu söyler", () => {
    expect(templateNotFoundMessage({ xsltName: null, status: "missing" })).toContain("aktif bir e-Arşiv şablonu seçili değil")
  })
  it("liste okunamadıysa uydurmaz", () => {
    expect(templateNotFoundMessage({ xsltName: "x", status: "missing", listFailed: true })).toContain("doğrulanamadı")
  })
})
