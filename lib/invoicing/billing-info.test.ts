import { describe, expect, it } from "vitest"
import {
  billingSnapshot,
  companyFillFromBilling,
  isValidTaxNumber,
  normalizeBillingInput,
} from "./billing-info"

const complete = {
  name: "ÖRNEK TİCARET LİMİTED ŞİRKETİ",
  taxNumber: "0860998219",
  taxOffice: "GÖKPINAR",
  address: "Kınıklı Mah. 6040 Sok. No:6/5",
  city: "Denizli",
  email: "muhasebe@ornek.com.tr",
}

describe("isValidTaxNumber", () => {
  it("10 haneli VKN ve 11 haneli TCKN kabul eder", () => {
    expect(isValidTaxNumber("0860998219")).toBe(true)
    expect(isValidTaxNumber("12345678901")).toBe(true)
  })

  it("placeholder ve hatalı uzunlukları reddeder", () => {
    // Hepsi aynı rakam: e-Fatura'da posta kutusu bulunamaz, e-Arşiv'de belge
    // düzeltilemez biçimde yanlış alıcıya bağlanır.
    expect(isValidTaxNumber("11111111111")).toBe(false)
    expect(isValidTaxNumber("0000000000")).toBe(false)
    expect(isValidTaxNumber("123456789")).toBe(false)
    expect(isValidTaxNumber("")).toBe(false)
  })
})

describe("normalizeBillingInput", () => {
  it("eksiksiz girdiyi normalleştirir", () => {
    const res = normalizeBillingInput({ ...complete, taxNumber: " 086 099 8219 " })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.taxNumber).toBe("0860998219")
      expect(res.value.district).toBeNull()
    }
  })

  it("eksik alanları isimleriyle bildirir", () => {
    const res = normalizeBillingInput({ name: "AB" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.fields).toEqual(
        expect.arrayContaining(["name", "taxNumber", "address", "city", "email"]),
      )
    }
  })

  it("vergi dairesini yalnız 10 haneli VKN'de zorunlu tutar", () => {
    const vkn = normalizeBillingInput({ ...complete, taxOffice: "" })
    expect(vkn.ok).toBe(false)
    if (!vkn.ok) expect(vkn.fields).toContain("taxOffice")

    // TCKN ile alışveriş eden gerçek kişinin vergi dairesi yoktur.
    const tckn = normalizeBillingInput({ ...complete, taxNumber: "12345678901", taxOffice: "" })
    expect(tckn.ok).toBe(true)
  })

  it("geçersiz e-postayı reddeder", () => {
    const res = normalizeBillingInput({ ...complete, email: "yok" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.fields).toEqual(["email"])
  })
})

describe("companyFillFromBilling", () => {
  it("yalnız BOŞ alanları doldurur, doluyu ezmez", () => {
    const res = normalizeBillingInput(complete)
    if (!res.ok) throw new Error("fixture geçersiz")

    const patch = companyFillFromBilling(
      {
        taxNumber: "0860998219",
        taxOffice: null,
        address: "Eski adres",
        city: null,
        email: null,
      },
      res.value,
    )
    // taxNumber ve address zaten dolu → dokunulmaz.
    expect(patch).toEqual({
      taxOffice: "GÖKPINAR",
      city: "Denizli",
      email: "muhasebe@ornek.com.tr",
    })
  })
})

describe("billingSnapshot", () => {
  it("sipariş kaydına yazılacak alanları üretir", () => {
    const res = normalizeBillingInput(complete)
    if (!res.ok) throw new Error("fixture geçersiz")
    expect(billingSnapshot(res.value)).toMatchObject({
      billingName: complete.name,
      billingTaxNumber: complete.taxNumber,
      billingTaxOffice: complete.taxOffice,
      billingCity: complete.city,
      billingEmail: complete.email,
    })
  })
})
