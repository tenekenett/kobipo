/**
 * Dekont denetimleri. IBAN mod-97 burada gerçek işe yaradı: uçtan uca testte
 * modelin bir hanesini yanlış okuduğu IBAN'ı yakaladı (plan günlüğü 2026-09-21).
 * "Bizim hesap" denetimi de yönü belirler: alıcı bizsek tahsilat, gönderen
 * bizsek ödeme — ikisi de değilse belge bu firmaya ait olmayabilir.
 */

import { describe, expect, it } from "vitest"
import type { Dekont } from "./schema"
import { dekontDenetle, dekontInsanaSorulmali, dekontYonu, ibanGecerliMi, ibanSade, islemTuruNormalize } from "./validate"

// Mod-97 geçerli, kurgusal IBAN'lar (bağımsız hesaplanmıştır).
const BIZIM = "TR330006100519786457841326"
const KARSI = "TR970006400001234567890100"
const BUGUN = new Date("2026-09-21T10:00:00Z")

function dekont(p: Partial<Dekont> = {}): Dekont {
  return {
    banka: "Ziraat", islemTarihi: "2026-09-18", tutar: 1500, paraBirimi: "TRY",
    gonderenAd: "EREN FORKLİFT", gonderenIban: KARSI, aliciAd: "REYPO", aliciIban: BIZIM,
    aciklama: "FTR2026000123 ödemesi", referansNo: "REF9988", islemTuru: "HAVALE",
    guven: { taraflar: 0.9, tarih: 0.9, tutar: 0.95 },
    ...p,
  }
}

const bul = (d: Dekont, anahtar: string, bizimIbanlar: string[] = [BIZIM]) =>
  dekontDenetle(d, { bizimIbanlar, bugun: BUGUN }).find((x) => x.anahtar === anahtar)!

describe("ibanGecerliMi", () => {
  it("mod-97 tutmayan IBAN'ı ve yanlış uzunluktaki TR IBAN'ı reddeder", () => {
    expect(ibanGecerliMi(BIZIM)).toBe(true)
    expect(ibanGecerliMi("TR33 0006 1005 1978 6457 8413 26")).toBe(true) // boşluklu basım
    expect(ibanGecerliMi("TR330006100519786457841327")).toBe(false) // tek hane sapması
    expect(ibanGecerliMi("TR3300061005197864578413")).toBe(false) // 24 hane
    expect(ibanGecerliMi(null)).toBe(false)
    expect(ibanGecerliMi("hesap no yok")).toBe(false)
  })

  it("ibanSade boşlukları atar ve büyütür", () => {
    expect(ibanSade(" tr33 0006 ")).toBe("TR330006")
    expect(ibanSade(null)).toBe("")
  })
})

describe("islemTuruNormalize", () => {
  it("küme dışını DIGER yapar", () => {
    expect(islemTuruNormalize("havale")).toBe("HAVALE")
    expect(islemTuruNormalize(" F.A.S.T ")).toBe("FAST")
    expect(islemTuruNormalize("kredi kartı")).toBe("DIGER")
    expect(islemTuruNormalize(null)).toBe("DIGER")
  })
})

describe("dekontYonu", () => {
  it("bizim IBAN alıcıdaysa tahsilat, gönderendeyse ödemedir", () => {
    expect(dekontYonu(dekont(), [BIZIM])).toBe("TAHSILAT")
    expect(dekontYonu(dekont({ gonderenIban: BIZIM, aliciIban: KARSI }), [BIZIM])).toBe("ODEME")
    expect(dekontYonu(dekont(), [KARSI.replace("TR97", "TR98")])).toBe("BELIRSIZ")
  })

  it("kayıtlı IBAN yoksa yön BELİRSİZ kalır — tahmin edilmez", () => {
    expect(dekontYonu(dekont(), [])).toBe("BELIRSIZ")
  })

  it("boşluklu/küçük harfli basım eşleşmeyi bozmaz", () => {
    expect(dekontYonu(dekont({ aliciIban: "tr33 0006 1005 1978 6457 8413 26" }), [BIZIM])).toBe("TAHSILAT")
  })
})

describe("dekontDenetle", () => {
  it("temiz dekontta bütün denetimler geçer", () => {
    expect(dekontDenetle(dekont(), { bizimIbanlar: [BIZIM], bugun: BUGUN }).every((d) => d.durum === "gecti")).toBe(true)
  })

  it("tutar okunamadıysa ölçülemez, 0/negatifse patlar", () => {
    expect(bul(dekont({ tutar: null }), "tutar").durum).toBe("olcelemedi")
    expect(bul(dekont({ tutar: 0 }), "tutar").durum).toBe("patladi")
  })

  it("iki IBAN ayrı ayrı ölçülür", () => {
    expect(bul(dekont({ gonderenIban: "TR970006400001234567890101" }), "gonderenIban").durum).toBe("patladi")
    expect(bul(dekont({ gonderenIban: null }), "gonderenIban").durum).toBe("olcelemedi")
    expect(bul(dekont(), "aliciIban").durum).toBe("gecti")
  })

  it("hiçbir IBAN bizim değilse 'bizim hesap' patlar; kayıtlı IBAN yoksa ölçülemez", () => {
    expect(bul(dekont(), "hesap").aciklama).toContain("tahsilat")
    expect(bul(dekont({ gonderenIban: BIZIM, aliciIban: KARSI }), "hesap").aciklama).toContain("ödeme")
    expect(bul(dekont(), "hesap", ["TR970006400001234567890100".replace("TR97", "TR98")]).durum).toBe("patladi")
    expect(bul(dekont(), "hesap", []).durum).toBe("olcelemedi")
  })

  it("gelecek tarihli dekont patlar", () => {
    expect(bul(dekont({ islemTarihi: "2026-10-01" }), "tarih").durum).toBe("patladi")
    expect(bul(dekont({ islemTarihi: "18.09.2026" }), "tarih").durum).toBe("patladi")
    expect(bul(dekont({ islemTarihi: null }), "tarih").durum).toBe("olcelemedi")
  })
})

describe("dekontInsanaSorulmali", () => {
  it("patlayan denetim ya da düşük güven insana sorar", () => {
    const temiz = dekontDenetle(dekont(), { bizimIbanlar: [BIZIM], bugun: BUGUN })
    expect(dekontInsanaSorulmali(temiz, dekont())).toBe(false)
    expect(dekontInsanaSorulmali(temiz, dekont({ guven: { taraflar: 0.5, tarih: 0.9, tutar: 0.9 } }))).toBe(true)
    expect(dekontInsanaSorulmali(dekontDenetle(dekont({ tutar: 0 }), { bizimIbanlar: [BIZIM], bugun: BUGUN }), dekont())).toBe(true)
  })
})
