import { describe, expect, it } from "vitest"
import {
  credentialDecryptError,
  resolveEInvoiceCredentials,
  E_INVOICE_CREDENTIAL_SELECT,
} from "./credentials"

/**
 * Şubede e-Dönüşüm kimliği. Şube ayrı tüzel kişi DEĞİL: aynı VKN'nin ikinci
 * adresidir, Mysoft'ta ayrı mükellefi ve ayrı şablon kümesi yoktur. Kimlik şube
 * kurulurken kopyalanıyor ama yalnız o an; ana firmaya SONRADAN girilen
 * kullanıcı/şifre şubede boş kalıyor ve ekranlar "API bilgileri eksik" diyordu.
 */

const own = {
  eDonusumApiUsername: "sube_user",
  eDonusumApiPassword: "enc:sube",
  eDonusumApiUrl: "https://sube.example",
}

const parent = {
  eDonusumApiUsername: "ana_user",
  eDonusumApiPassword: "enc:ana",
  eDonusumApiUrl: "https://ana.example",
}

describe("kimlik çözümü", () => {
  it("firmanın kendi kimliği varsa ana firmaya BAKMAZ", () => {
    // Bugün çalışan hiçbir şube kimliği değişmemeli: devralma yalnız boşluğu doldurur.
    expect(resolveEInvoiceCredentials({ ...own, parentCompany: parent })).toEqual({
      username: "sube_user",
      password: "enc:sube",
      baseUrl: "https://sube.example",
      inherited: false,
    })
  })

  it("şubede eksik kimlik ana firmadan devralınır", () => {
    expect(
      resolveEInvoiceCredentials({
        eDonusumApiUsername: null,
        eDonusumApiPassword: null,
        parentCompany: parent,
      })
    ).toEqual({
      username: "ana_user",
      password: "enc:ana",
      baseUrl: "https://ana.example",
      inherited: true,
    })
  })

  it("kullanıcı adı VAR ama şifre yoksa yarım kimlik kullanılmaz", () => {
    // Yarım kimlikle provider kurmak Mysoft'a boş şifre gönderip 401 alırdı;
    // devralma bu boşluğu da doldurmalı.
    const resolved = resolveEInvoiceCredentials({
      eDonusumApiUsername: "sube_user",
      eDonusumApiPassword: null,
      parentCompany: parent,
    })
    expect(resolved?.username).toBe("ana_user")
    expect(resolved?.inherited).toBe(true)
  })

  it("devralınan kimlikte taban URL ana firmadan gelir", () => {
    // Şubenin kendi URL'si yedektir: karışırsa test/canlı ortam sessizce değişir.
    const resolved = resolveEInvoiceCredentials({
      eDonusumApiUrl: "https://sube.example",
      parentCompany: parent,
    })
    expect(resolved?.baseUrl).toBe("https://ana.example")
    // Ana firmanın URL'si boşsa şubedeki değer kullanılır.
    expect(
      resolveEInvoiceCredentials({
        eDonusumApiUrl: "https://sube.example",
        parentCompany: { ...parent, eDonusumApiUrl: null },
      })?.baseUrl
    ).toBe("https://sube.example")
  })

  it("ne kendi ne ana firma kimliği varsa null döner (bayi yolu / hata)", () => {
    expect(resolveEInvoiceCredentials({})).toBeNull()
    expect(resolveEInvoiceCredentials(null)).toBeNull()
    expect(resolveEInvoiceCredentials({ parentCompany: null })).toBeNull()
    expect(
      resolveEInvoiceCredentials({ parentCompany: { eDonusumApiUsername: "ana_user" } })
    ).toBeNull()
  })

  it("ana firma (şube olmayan) için davranış değişmez", () => {
    expect(resolveEInvoiceCredentials(own)?.inherited).toBe(false)
  })
})

describe("hata mesajı kimliğin SAHİBİNE yöneltir", () => {
  it("devralınmış şifre çözülemezse ana firmayı gösterir", () => {
    expect(credentialDecryptError(true)).toContain("Ana firmanın")
    expect(credentialDecryptError(false)).not.toContain("Ana firmanın")
  })
})

describe("prisma select", () => {
  it("ana firmanın kimlik alanlarını da seçer", () => {
    // Alt select düşerse çözücü ana firmayı hiç göremez ve hata sessizce geri gelir.
    expect(Object.keys(E_INVOICE_CREDENTIAL_SELECT.parentCompany.select).sort()).toEqual([
      "eDonusumApiPassword",
      "eDonusumApiUrl",
      "eDonusumApiUsername",
    ])
  })
})
