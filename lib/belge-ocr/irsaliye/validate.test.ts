/**
 * İrsaliye denetimleri — plan Faz 2'de "birim test YOK" diye bırakılmıştı.
 * İrsaliyede tutar yoktur; belgenin taşıdığı tek sayı MİKTARDIR ve stok ona
 * göre girer, bu yüzden miktarsız satır sessizce geçirilmez.
 */

import { describe, expect, it } from "vitest"
import type { Irsaliye, IrsaliyeKalem } from "./schema"
import { irsaliyeDenetle, irsaliyeInsanaSorulmali } from "./validate"

const BIZ = "7352344835"
const TEDARIKCI = "3531285187"
const BUGUN = new Date("2026-09-21T10:00:00Z")

const kalem = (p: Partial<IrsaliyeKalem> = {}): IrsaliyeKalem => ({ ad: "Ürün A", saticiKodu: null, miktar: 5, birim: "ADET", ...p })

function irsaliye(p: Partial<Irsaliye> = {}): Irsaliye {
  return {
    saticiUnvan: "EREN FORKLİFT", saticiVknTckn: TEDARIKCI, aliciUnvan: "REYPO", aliciVknTckn: BIZ,
    irsaliyeNo: "IRS2026000001", ettn: null, duzenlemeTarihi: "2026-09-01", sevkTarihi: "2026-09-01",
    tasiyici: null, plaka: null, sofor: null, sevkAdresi: null, faturaNoAtfi: null,
    kalemler: [kalem()], guven: { satici: 0.9, alici: 0.9, tarih: 0.9, kalemler: 0.9 },
    ...p,
  }
}

const bul = (i: Irsaliye, anahtar: string, yon: "ALIS" | "SATIS" = "ALIS") =>
  irsaliyeDenetle(i, { firmaVkn: BIZ, yon, bugun: BUGUN }).find((d) => d.anahtar === anahtar)!

describe("irsaliyeDenetle", () => {
  it("alışta alıcı, satışta satıcı biz olmalıyız", () => {
    expect(bul(irsaliye(), "taraf").durum).toBe("gecti")
    expect(bul(irsaliye(), "taraf", "SATIS").durum).toBe("patladi")
    expect(bul(irsaliye({ aliciVknTckn: null }), "taraf").durum).toBe("olcelemedi")
  })

  it("karşı tarafın numarası checksum'dan geçer", () => {
    expect(bul(irsaliye(), "vkn").etiket).toBe("Tedarikçi VKN")
    expect(bul(irsaliye({ saticiVknTckn: "1111111111" }), "vkn").durum).toBe("patladi")
    expect(bul(irsaliye({ saticiVknTckn: "11111111110" }), "vkn").durum).toBe("gecti")
    expect(bul(irsaliye({ saticiVknTckn: null }), "vkn").durum).toBe("olcelemedi")
  })

  it("miktarsız satır ve kalemsiz belge patlar", () => {
    expect(bul(irsaliye(), "miktar").durum).toBe("gecti")
    expect(bul(irsaliye({ kalemler: [kalem(), kalem({ ad: "Ürün B", miktar: null })] }), "miktar").aciklama).toContain("Ürün B")
    expect(bul(irsaliye({ kalemler: [kalem({ miktar: 0 })] }), "miktar").durum).toBe("patladi")
    expect(bul(irsaliye({ kalemler: [] }), "miktar").aciklama).toBe("Kalem okunamadı")
  })

  it("sevk tarihi düzenlemeden önce olamaz", () => {
    expect(bul(irsaliye(), "tarih").durum).toBe("gecti")
    expect(bul(irsaliye({ sevkTarihi: "2026-08-30" }), "tarih").aciklama).toContain("Sevk")
    expect(bul(irsaliye({ sevkTarihi: "2026-09-02" }), "tarih").durum).toBe("gecti")
    expect(bul(irsaliye({ duzenlemeTarihi: "2026-10-05" }), "tarih").aciklama).toContain("Gelecek tarih")
    expect(bul(irsaliye({ duzenlemeTarihi: null }), "tarih").durum).toBe("olcelemedi")
  })
})

describe("irsaliyeInsanaSorulmali", () => {
  it("patlayan denetim ya da düşük güven insana sorar", () => {
    const temiz = irsaliyeDenetle(irsaliye(), { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN })
    expect(irsaliyeInsanaSorulmali(temiz, irsaliye())).toBe(false)
    expect(irsaliyeInsanaSorulmali(temiz, irsaliye({ guven: { satici: 0.9, alici: 0.9, tarih: 0.9, kalemler: 0.5 } }))).toBe(true)
    const bozuk = irsaliyeDenetle(irsaliye({ kalemler: [] }), { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN })
    expect(irsaliyeInsanaSorulmali(bozuk, irsaliye())).toBe(true)
  })
})
