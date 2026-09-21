/**
 * Çek/senet denetimleri ve `/api/cek-senet` gövdesi.
 *
 * En kritik vaka TARAF denetimi: çekte çoğu zaman yalnız KEŞİDECİNİN VKN'si
 * basılır. "Lehtar VKN'si bize eşit değil" diye patlatmak her alınan çeki
 * kırmızıya boyuyordu (uçtan uca testte ölçüldü, plan günlüğü 2026-09-21).
 */

import { describe, expect, it } from "vitest"
import type { CekSenet } from "./schema"
import { cekDenetle, cekInsanaSorulmali, cekToBody, cekTuruNormalize } from "./validate"

const BIZ = "7352344835"
const KARSI = "3531285187"
const BUGUN = new Date("2026-09-21T10:00:00Z")

function cek(p: Partial<CekSenet> = {}): CekSenet {
  return {
    tur: "CEK", banka: "Ziraat", sube: "Denizli", hesapNo: "1234567", seriNo: "0012345",
    tutar: 25000, paraBirimi: "TRY", kesideTarihi: "2026-09-01", vadeTarihi: "2026-12-01",
    kesideci: "EREN FORKLİFT", kesideciVknTckn: KARSI, lehtar: "REYPO", lehtarVknTckn: null,
    kesideYeri: "DENİZLİ", guven: { taraflar: 0.9, tarih: 0.9, tutar: 0.9 },
    ...p,
  }
}

const bul = (c: CekSenet, anahtar: string, yon: "ALIS" | "SATIS" = "ALIS", firmaVkn: string | null = BIZ) =>
  cekDenetle(c, { firmaVkn, yon, bugun: BUGUN }).find((d) => d.anahtar === anahtar)

describe("cekTuruNormalize", () => {
  it("senet/bono dışındaki her şey çektir", () => {
    expect(cekTuruNormalize("senet")).toBe("SENET")
    expect(cekTuruNormalize("BONO")).toBe("SENET")
    expect(cekTuruNormalize("çek")).toBe("CEK")
    expect(cekTuruNormalize(null)).toBe("CEK")
  })
})

describe("cekDenetle — taraf", () => {
  it("alınan çekte lehtar VKN'si BASILMAMIŞSA keşidecinin biz olmaması yeter", () => {
    const d = bul(cek(), "taraf")!
    expect(d.durum).toBe("gecti")
    expect(d.aciklama).toContain("Keşideci biz değiliz")
  })

  it("alınan çekte lehtar VKN'si basılmışsa biz olmalıyız", () => {
    expect(bul(cek({ lehtarVknTckn: BIZ }), "taraf")!.durum).toBe("gecti")
    expect(bul(cek({ lehtarVknTckn: "1111111114" }), "taraf")!.durum).toBe("patladi")
  })

  it("verilen çekte keşideci biziz; keşideci başkasıysa yön yanlıştır", () => {
    expect(bul(cek({ kesideciVknTckn: BIZ, lehtarVknTckn: KARSI }), "taraf", "SATIS")!.durum).toBe("gecti")
    expect(bul(cek(), "taraf", "SATIS")!.durum).toBe("patladi")
    // Keşideci VKN'si basılmamış verilen çek: lehtar biz olmamalıyız.
    expect(bul(cek({ kesideciVknTckn: null, lehtarVknTckn: KARSI }), "taraf", "SATIS")!.durum).toBe("gecti")
  })

  it("hiç VKN yoksa ya da firmanın VKN'si kayıtlı değilse ölçülemez", () => {
    expect(bul(cek({ kesideciVknTckn: null, lehtarVknTckn: null }), "taraf")!.durum).toBe("olcelemedi")
    expect(bul(cek(), "taraf", "ALIS", null)!.durum).toBe("olcelemedi")
  })

  it("karşı tarafın VKN'si checksum'dan geçer; basılmamışsa denetim üretilmez", () => {
    expect(bul(cek(), "vkn")!.durum).toBe("gecti")
    expect(bul(cek({ kesideciVknTckn: "1111111111" }), "vkn")!.durum).toBe("patladi")
    expect(bul(cek({ kesideciVknTckn: null }), "vkn")).toBeUndefined()
  })
})

describe("cekDenetle — zorunlu alanlar ve vade", () => {
  it("numara ve çekte banka zorunludur, senette banka sorulmaz", () => {
    expect(bul(cek({ seriNo: null }), "no")!.durum).toBe("patladi")
    expect(bul(cek({ banka: null }), "banka")!.durum).toBe("patladi")
    expect(bul(cek({ tur: "SENET", banka: null }), "banka")).toBeUndefined()
  })

  it("tutar 0/negatif patlar, okunamadıysa ölçülemez", () => {
    expect(bul(cek({ tutar: 0 }), "tutar")!.durum).toBe("patladi")
    expect(bul(cek({ tutar: null }), "tutar")!.durum).toBe("olcelemedi")
  })

  it("vade keşideden önce olamaz ve bir yıldan eski vade şüphelidir", () => {
    expect(bul(cek(), "tarih")!.durum).toBe("gecti")
    expect(bul(cek({ vadeTarihi: "2026-08-01" }), "tarih")!.aciklama).toContain("önce")
    expect(bul(cek({ kesideTarihi: "2025-01-01", vadeTarihi: "2025-06-01" }), "tarih")!.aciklama).toContain("bir yıldan eski")
    expect(bul(cek({ vadeTarihi: null }), "tarih")!.durum).toBe("olcelemedi")
  })
})

describe("cekToBody", () => {
  it("alınan çek müşteriye, verilen çek tedarikçiye bağlanır", () => {
    const alinan = cekToBody(cek(), { companyId: "c1", yon: "ALIS", customerId: "m1", bugun: BUGUN }).body
    expect(alinan).toMatchObject({ type: "CHECK", direction: "RECEIVED", customerId: "m1", checkNo: "0012345", bankName: "Ziraat", branchName: "Denizli", accountNo: "1234567", amount: 25000, issueDate: "2026-09-01", dueDate: "2026-12-01" })
    const verilen = cekToBody(cek(), { companyId: "c1", yon: "SATIS", supplierId: "s1", bugun: BUGUN }).body
    expect(verilen).toMatchObject({ direction: "GIVEN", supplierId: "s1" })
  })

  it("senet banka alanlarını taşımaz, noteNo yazar", () => {
    const { body } = cekToBody(cek({ tur: "senet" }), { companyId: "c1", yon: "ALIS", customerId: "m1", bugun: BUGUN })
    expect(body.type).toBe("PROMISSORY_NOTE")
    expect(body.noteNo).toBe("0012345")
    expect(body).not.toHaveProperty("checkNo")
    expect(body).not.toHaveProperty("bankName")
  })

  it("keşide tarihi okunamadıysa vade yazılır ve söylenir", () => {
    const { body, uyarilar } = cekToBody(cek({ kesideTarihi: null }), { companyId: "c1", yon: "ALIS", customerId: "m1", bugun: BUGUN })
    expect(body.issueDate).toBe("2026-12-01")
    expect(uyarilar.find((u) => u.anahtar === "keside")).toBeTruthy()
  })

  it("numara yoksa ağır uyarı, cari yoksa uyarı (kayıt kilitlenmez)", () => {
    const { uyarilar } = cekToBody(cek({ seriNo: null }), { companyId: "c1", yon: "ALIS", bugun: BUGUN })
    expect(uyarilar.find((u) => u.anahtar === "no")?.agir).toBe(true)
    expect(uyarilar.find((u) => u.anahtar === "cari")?.agir).toBeUndefined()
  })

  it("keşideci/lehtar/keşide yeri nota yazılır", () => {
    const { body } = cekToBody(cek(), { companyId: "c1", yon: "ALIS", customerId: "m1", kaynak: "çek fotoğrafı", bugun: BUGUN })
    expect(body.notes).toContain("Keşideci: EREN FORKLİFT")
    expect(body.notes).toContain("Lehtar: REYPO")
    expect(body.notes).toContain("Keşide yeri: DENİZLİ")
    expect(body.notes).toContain("çek fotoğrafı")
  })

  it("iki tarih de okunamadıysa bugüne düşer", () => {
    const { body } = cekToBody(cek({ kesideTarihi: null, vadeTarihi: null }), { companyId: "c1", yon: "ALIS", customerId: "m1", bugun: BUGUN })
    expect(body.dueDate).toBe("2026-09-21")
    expect(body.issueDate).toBe("2026-09-21")
  })
})

describe("cekInsanaSorulmali", () => {
  it("patlayan denetim ya da düşük güven insana sorar", () => {
    const temiz = cekDenetle(cek(), { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN })
    expect(cekInsanaSorulmali(temiz, cek())).toBe(false)
    expect(cekInsanaSorulmali(temiz, cek({ guven: { taraflar: 0.7, tarih: 0.9, tutar: 0.9 } }))).toBe(true)
    expect(cekInsanaSorulmali(cekDenetle(cek({ seriNo: null }), { firmaVkn: BIZ, yon: "ALIS", bugun: BUGUN }), cek())).toBe(true)
  })
})
