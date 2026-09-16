import { describe, expect, it } from "vitest"
import { defaultedAccountNote, withAccountNote } from "./hesapsiz-odeme"

describe("defaultedAccountNote", () => {
  it("hesap seçilmiş ödemede not yok", () => {
    expect(defaultedAccountNote([{ accountDefaulted: false, account: { name: "Banka" } }])).toBeNull()
    expect(defaultedAccountNote([])).toBeNull()
    // Yanıt okunamadıysa (json hatası) sessizce not üretmez, kırılmaz.
    expect(defaultedAccountNote([null, undefined])).toBeNull()
  })

  it("varsayılana düşen ödeme hesabın adını söyler", () => {
    expect(
      defaultedAccountNote([{ accountDefaulted: true, accountCreated: false, account: { name: "Merkez Kasa" } }]),
    ).toBe("Hesap seçilmedi: tutar «Merkez Kasa» hesabına yazıldı")
  })

  it("kasa bu ödemeyle açıldıysa bunu ayrıca söyler", () => {
    expect(defaultedAccountNote([{ accountDefaulted: true, accountCreated: true, account: { name: "Kasa" } }])).toBe(
      "Hesap seçilmedi: «Kasa» hesabı açıldı ve tutar oraya yazıldı",
    )
  })

  it("parçalı ödemede tek not: yalnız varsayılana düşen parçalar sayılır", () => {
    const note = defaultedAccountNote([
      { accountDefaulted: false, account: { name: "POS" } },
      { accountDefaulted: true, accountCreated: true, account: { name: "Kasa" } },
      { accountDefaulted: true, accountCreated: false, account: { name: "Kasa" } },
    ])
    expect(note).toBe("Hesap seçilmedi: «Kasa» hesabı açıldı ve tutar oraya yazıldı")
  })
})

describe("withAccountNote", () => {
  it("not yoksa açıklamaya dokunmaz", () => {
    expect(withAccountNote("FIS-1 oluşturuldu", null)).toBe("FIS-1 oluşturuldu")
    expect(withAccountNote("FIS-1 oluşturuldu", "Not")).toBe("FIS-1 oluşturuldu. Not")
  })
})
