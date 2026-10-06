import { describe, expect, it } from "vitest"
import {
  faturaEpostaAdresi,
  gelenBildirimKarari,
  gelenBildirimSiniri,
  gelisZamani,
  gidenGonderilebilir,
  gibPostaKutusuMu,
  GELEN_TAZELIK_SAAT,
  hesapKurucusu,
  MAX_DENEME,
  OTOMATIK_EPOSTA_BASLANGIC,
} from "./kurallar"

describe("faturaEpostaAdresi", () => {
  it("boş alan → YOK", () => {
    expect(faturaEpostaAdresi(null)).toEqual({ ok: false, sebep: "YOK" })
    expect(faturaEpostaAdresi("   ")).toEqual({ ok: false, sebep: "YOK" })
  })

  it("geçerli adresi kırpar ve küçültür", () => {
    expect(faturaEpostaAdresi("  Muhasebe@Firma.com.tr ")).toEqual({
      ok: true,
      adresler: ["muhasebe@firma.com.tr"],
    })
  })

  it("GİB posta kutusu etiketi e-posta sayılmaz", () => {
    expect(faturaEpostaAdresi("urn:mail:defaultpk@firma.com.tr")).toEqual({ ok: false, sebep: "GIB_PK" })
    expect(faturaEpostaAdresi("defaultpk@muhasebat.gov.tr")).toEqual({ ok: false, sebep: "GIB_PK" })
    expect(gibPostaKutusuMu("defaultgb@x.com")).toBe(true)
    expect(gibPostaKutusuMu("pk@x.com")).toBe(false)
  })

  it("çoklu adres: geçerlilerin hepsi, en çok 3, tekrar yok", () => {
    expect(faturaEpostaAdresi("a@x.com; b@y.com, A@X.com")).toEqual({ ok: true, adresler: ["a@x.com", "b@y.com"] })
    expect(faturaEpostaAdresi("a@x.com b@x.com c@x.com d@x.com")).toEqual({
      ok: true,
      adresler: ["a@x.com", "b@x.com", "c@x.com"],
    })
  })

  it("bir parça geçersizse diğerleri yine gider", () => {
    expect(faturaEpostaAdresi("yanlis; dogru@firma.com")).toEqual({ ok: true, adresler: ["dogru@firma.com"] })
    expect(faturaEpostaAdresi("defaultpk@x.com; dogru@firma.com")).toEqual({
      ok: true,
      adresler: ["dogru@firma.com"],
    })
  })

  it("biçimi bozuk ya da var olmayan alan → GECERSIZ", () => {
    expect(faturaEpostaAdresi("firma.com")).toEqual({ ok: false, sebep: "GECERSIZ" })
    expect(faturaEpostaAdresi("a@b")).toEqual({ ok: false, sebep: "GECERSIZ" })
    expect(faturaEpostaAdresi("musteri-deneme-1@test.kobipo")).toEqual({ ok: false, sebep: "GECERSIZ" })
    expect(faturaEpostaAdresi("x@example.com")).toEqual({ ok: false, sebep: "GECERSIZ" })
  })

  it("mailto: önekini atar", () => {
    expect(faturaEpostaAdresi("mailto:a@x.com")).toEqual({ ok: true, adresler: ["a@x.com"] })
  })
})

describe("gidenGonderilebilir", () => {
  const temel = { type: "SALES", invoiceType: "E_ARCHIVE", status: "SENT", uuid: "u", isReceipt: false }

  it("GİB'e gitmiş satış e-belgesi gönderilir", () => {
    expect(gidenGonderilebilir(temel)).toEqual({ ok: true })
    expect(gidenGonderilebilir({ ...temel, invoiceType: "E_INVOICE", type: "RETURN" })).toEqual({ ok: true })
  })

  it("alış faturası, fiş, Manuel, taslak gönderilmez", () => {
    expect(gidenGonderilebilir({ ...temel, type: "PURCHASE" }).ok).toBe(false)
    expect(gidenGonderilebilir({ ...temel, isReceipt: true }).ok).toBe(false)
    expect(gidenGonderilebilir({ ...temel, invoiceType: "MANUAL" }).ok).toBe(false)
    expect(gidenGonderilebilir({ ...temel, status: "GIB_DRAFT" }).ok).toBe(false)
    expect(gidenGonderilebilir({ ...temel, uuid: null }).ok).toBe(false)
  })
})

describe("gelen bildirim", () => {
  const simdi = new Date("2026-10-06T12:00:00Z")
  const saatOnce = (h: number) => new Date(simdi.getTime() - h * 3_600_000)
  /** Başlangıcı çok eskide: yalnız tazelik kuralı ölçülür. */
  const ESKI_BASLANGIC = new Date("2026-01-01T00:00:00Z")

  it("geliş: zarf tarihi → belge tarihi → ilk görülme", () => {
    const createdAt = saatOnce(1)
    expect(gelisZamani({ sentDate: saatOnce(5), docDate: saatOnce(50), createdAt })).toEqual(saatOnce(5))
    expect(gelisZamani({ sentDate: null, docDate: saatOnce(50), createdAt })).toEqual(saatOnce(50))
    expect(gelisZamani({ sentDate: null, docDate: null, createdAt })).toEqual(createdAt)
  })

  it("taze fatura gönderilir, eski senkron bildirilmez", () => {
    expect(gelenBildirimKarari({ gelis: saatOnce(2), simdi, deneme: 0, baslangic: ESKI_BASLANGIC })).toBe("GONDER")
    expect(gelenBildirimKarari({ gelis: saatOnce(GELEN_TAZELIK_SAAT - 1), simdi, deneme: 0, baslangic: ESKI_BASLANGIC })).toBe("GONDER")
    expect(gelenBildirimKarari({ gelis: saatOnce(GELEN_TAZELIK_SAAT + 1), simdi, deneme: 0, baslangic: ESKI_BASLANGIC })).toBe("ESKI")
  })

  it("otomatik mailin başlangıcından önce gelen fatura bildirilmez (tazelik içinde olsa da)", () => {
    const baslangic = saatOnce(3)
    expect(gelenBildirimKarari({ gelis: saatOnce(5), simdi, deneme: 0, baslangic })).toBe("ESKI")
    expect(gelenBildirimKarari({ gelis: saatOnce(2), simdi, deneme: 0, baslangic })).toBe("GONDER")
    expect(gelenBildirimSiniri(simdi, baslangic)).toEqual(baslangic)
    // Başlangıç çok eskideyse sınır tazeliktir.
    expect(gelenBildirimSiniri(simdi, ESKI_BASLANGIC)).toEqual(saatOnce(GELEN_TAZELIK_SAAT))
  })

  it("başlangıç anı kodda sabittir ve geriye kaymaz", () => {
    // Geriye çekilirse geçmiş faturalar müşterilere/kurucuya dökülür (kullanıcı kararı 2026-10-06).
    expect(OTOMATIK_EPOSTA_BASLANGIC.toISOString()).toBe("2026-10-06T17:50:00.000Z")
  })

  it("denenmiş bildirim tazeliği aşınca HATA olarak kapanır (eski diye kaybolmaz)", () => {
    expect(gelenBildirimKarari({ gelis: saatOnce(GELEN_TAZELIK_SAAT + 1), simdi, deneme: 2, baslangic: ESKI_BASLANGIC })).toBe("HATA_SON")
    expect(gelenBildirimKarari({ gelis: saatOnce(1), simdi, deneme: MAX_DENEME, baslangic: ESKI_BASLANGIC })).toBe("HATA_SON")
  })
})

describe("hesapKurucusu", () => {
  const u = (userId: string, gun: number, isSuperAdmin = false, email: string | null = `${userId}@x.com`) => ({
    userId,
    email,
    isSuperAdmin,
    createdAt: new Date(2026, 3, gun),
  })

  it("en eski yönetici üyeliği", () => {
    expect(hesapKurucusu([u("b", 20), u("a", 5), u("c", 30)])?.userId).toBe("a")
  })

  it("süper-admin ve e-postasız üyelik kurucu sayılmaz", () => {
    expect(hesapKurucusu([u("sa", 1, true), u("bos", 2, false, ""), u("m", 3)])?.userId).toBe("m")
  })

  it("aday yoksa null", () => {
    expect(hesapKurucusu([u("sa", 1, true)])).toBeNull()
    expect(hesapKurucusu([])).toBeNull()
  })
})
