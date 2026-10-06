import { describe, expect, it } from "vitest"
import { BOS_KAMU_BILGISI, kamuAlaniGeldi, kamuBilgisiHatasi, mergeKamuBilgisi, type KamuBilgisi } from "./kamu-bilgisi"

const IBAN = "TR330006100519786457841326"
const kayitli: KamuBilgisi = {
  isPublicInstitution: true,
  publicPaymentAccountId: "acc1",
  publicPayeeVkn: "1234567890",
  publicPayeeName: "YAPI İŞLERİ",
  publicPayeeCity: "DENİZLİ",
  publicPayeeDistrict: "PAMUKKALE",
}
const hesap = { id: "acc1", name: "Banka A", type: "BANK", iban: IBAN, currency: "TRY", isActive: true }

describe("mergeKamuBilgisi", () => {
  it("gönderilmeyen alan mevcut değerde kalır (ilgisiz PUT kamu bilgisini silmez)", () => {
    expect(mergeKamuBilgisi({ phone: "0555" }, kayitli)).toEqual(kayitli)
    expect(kamuAlaniGeldi({ phone: "0555" })).toBe(false)
  })
  it("boş gönderilen alan temizlenir; VKN rakama indirgenir", () => {
    const v = mergeKamuBilgisi({ publicPaymentAccountId: "", publicPayeeVkn: "123 456 7890 " }, kayitli)
    expect(v.publicPaymentAccountId).toBeNull()
    expect(v.publicPayeeVkn).toBe("1234567890")
  })
  it("yeni kayıtta varsayılanlar boş", () => {
    expect(mergeKamuBilgisi({}, null)).toEqual(BOS_KAMU_BILGISI)
  })
})

describe("kamuBilgisiHatasi", () => {
  it("geçerli kayıt", () => {
    expect(kamuBilgisiHatasi(kayitli, hesap)).toBeNull()
  })
  it("başka firmanın / olmayan hesabı reddeder", () => {
    expect(kamuBilgisiHatasi(kayitli, null)).toContain("bulunamadı")
  })
  it("IBAN'sız ya da kasa hesabını reddeder", () => {
    expect(kamuBilgisiHatasi(kayitli, { ...hesap, iban: null })).toContain("kullanılamaz")
    expect(kamuBilgisiHatasi(kayitli, { ...hesap, type: "CASH" })).toContain("kullanılamaz")
  })
  it("yarım harcama birimini reddeder", () => {
    expect(kamuBilgisiHatasi({ ...kayitli, publicPayeeName: null }, hesap)).toContain("ünvanı")
  })
})
