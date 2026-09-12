import { describe, expect, it } from "vitest"
import { branchPartyWarning, resolveBranchParty } from "./branch-party"

/**
 * Şube, ana firmanın VKN'siyle fatura keser; Mysoft satıcı ünvan/adresini VKN
 * başına tuttuğu mükellef kaydından yazar. Bu yüzden Kadıköy şubesinin kestiği
 * fatura merkezin adresiyle gidiyordu. Şubenin kendi adresi belgeye AgentParty
 * ("ŞUBE BİLGİLERİ") olarak girer — kuralı burada tutuyoruz.
 */
const ANA = { address: "Atatürk Cad. No:1", city: "İstanbul" }

describe("resolveBranchParty", () => {
  it("farklı adresteki şubeyi belgeye yazar", () => {
    expect(
      resolveBranchParty({
        name: "ÖRNEK GIDA A.Ş.",
        address: "Bağdat Cad. No:90",
        city: "İstanbul",
        phone: "0216 111 22 33",
        email: "kadikoy@ornek.com",
        parentCompanyId: "ana-1",
        parentCompany: ANA,
      }),
    ).toEqual({
      name: "ÖRNEK GIDA A.Ş.",
      branchNo: "1",
      address: "Bağdat Cad. No:90",
      city: "İstanbul",
      phone: "0216 111 22 33",
      email: "kadikoy@ornek.com",
    })
  })

  /** Ana firmanın adresi zaten mükellef kaydındadır; ikinci kez yazmak tekrar olurdu. */
  it("şube olmayan firmada null döner (ana firma / ek firma)", () => {
    expect(
      resolveBranchParty({
        name: "ÖRNEK GIDA A.Ş.",
        address: "Atatürk Cad. No:1",
        city: "İstanbul",
        parentCompanyId: null,
        parentCompany: null,
      }),
    ).toBeNull()
  })

  /** Aynı adreste açılmış şube (ör. ayrı kasa): "ŞUBE BİLGİLERİ" bloğu bilgi katmaz. */
  it("adres ana firmayla aynıysa null döner — büyük/küçük harf ve fazla boşluk sayılmaz", () => {
    expect(
      resolveBranchParty({
        name: "ÖRNEK GIDA A.Ş.",
        address: "  ATATÜRK   CAD. NO:1 ",
        city: "İSTANBUL",
        parentCompanyId: "ana-1",
        parentCompany: ANA,
      }),
    ).toBeNull()
  })

  it("şehir aynı ama adres farklıysa yazılır", () => {
    const r = resolveBranchParty({
      name: "ÖRNEK GIDA A.Ş.",
      address: "Bağdat Cad. No:90",
      city: "İstanbul",
      parentCompanyId: "ana-1",
      parentCompany: ANA,
    })
    expect(r?.address).toBe("Bağdat Cad. No:90")
  })

  /**
   * UBL-TR'de PostalAddress içinde İl ve İlçe zorunludur; yarım adresle giden
   * belgeyi GİB şematronu TAMAMEN reddeder. Yarım bilgi hiç gönderilmez.
   */
  it("adres veya şehir eksikse null döner (yarım adres belgeyi reddettirir)", () => {
    const eksikSehir = {
      name: "ÖRNEK GIDA A.Ş.",
      address: "Bağdat Cad. No:90",
      city: "   ",
      parentCompanyId: "ana-1",
      parentCompany: ANA,
    }
    expect(resolveBranchParty(eksikSehir)).toBeNull()
    expect(
      resolveBranchParty({ ...eksikSehir, address: "", city: "İstanbul" }),
    ).toBeNull()
  })

  it("ilçe girilmişse taşınır, girilmemişse alan hiç eklenmez (provider il'e düşer)", () => {
    const temel = {
      name: "ÖRNEK GIDA A.Ş.",
      address: "Bağdat Cad. No:90",
      city: "İstanbul",
      parentCompanyId: "ana-1",
      parentCompany: ANA,
    }
    expect(resolveBranchParty({ ...temel, district: "Kadıköy" })?.district).toBe("Kadıköy")
    expect(resolveBranchParty({ ...temel, district: "  " })).not.toHaveProperty("district")
  })

  it("telefon/e-posta boşsa alan hiç eklenmez", () => {
    const r = resolveBranchParty({
      name: "ÖRNEK GIDA A.Ş.",
      address: "Bağdat Cad. No:90",
      city: "İstanbul",
      phone: "  ",
      email: null,
      parentCompanyId: "ana-1",
      parentCompany: ANA,
    })
    expect(r).not.toHaveProperty("phone")
    expect(r).not.toHaveProperty("email")
  })

  it("ana firmanın adresi hiç yoksa şube yine yazılır", () => {
    expect(
      resolveBranchParty({
        name: "ÖRNEK GIDA A.Ş.",
        address: "Bağdat Cad. No:90",
        city: "İstanbul",
        parentCompanyId: "ana-1",
        parentCompany: { address: null, city: null },
      })?.city,
    ).toBe("İstanbul")
  })
})

describe("branchPartyWarning", () => {
  it("eksik alanı adıyla söyler", () => {
    expect(
      branchPartyWarning({
        name: "X",
        address: "Bağdat Cad. No:90",
        city: "",
        parentCompanyId: "ana-1",
        parentCompany: ANA,
      }),
    ).toContain("şehir")
    expect(
      branchPartyWarning({
        name: "X",
        address: "",
        city: "",
        parentCompanyId: "ana-1",
        parentCompany: ANA,
      }),
    ).toContain("adres ve şehir")
  })

  it("şube değilse ya da adres tamsa uyarı yok", () => {
    expect(branchPartyWarning({ name: "X", address: "", city: "", parentCompanyId: null })).toBe("")
    expect(
      branchPartyWarning({
        name: "X",
        address: "Bağdat Cad. No:90",
        city: "İstanbul",
        parentCompanyId: "ana-1",
      }),
    ).toBe("")
  })
})
