import { describe, expect, it } from "vitest"
import { kiymetPortfoyu, portfoydeMi, type KiymetBilancoKaydi } from "./bilanco-kiymet"

const SINIR = new Date("2026-09-01T00:00:00Z")
const kayit = (over: Partial<KiymetBilancoKaydi>): KiymetBilancoKaydi => ({
  amount: 1000,
  status: "PORTFÖYDE",
  issueDate: "2026-08-10",
  direction: "RECEIVED",
  supplierId: null,
  settledAt: null,
  ...over,
})

describe("portföyde mi — tarih itibarıyla", () => {
  it("sınırdan önce alınmış, portföyde duran evrak sayılır; sonra alınan sayılmaz", () => {
    expect(portfoydeMi(kayit({}), SINIR)).toBe(true)
    expect(portfoydeMi(kayit({ issueDate: "2026-09-05" }), SINIR)).toBe(false)
  })

  it("tahsil edilmiş evrak, tahsil hareketi sınırdan SONRAYSA o tarihte hâlâ portföydeydi", () => {
    expect(portfoydeMi(kayit({ status: "TAHSİL_EDİLDİ", settledAt: "2026-09-10" }), SINIR)).toBe(true)
    expect(portfoydeMi(kayit({ status: "TAHSİL_EDİLDİ", settledAt: "2026-08-20" }), SINIR)).toBe(false)
  })

  it("kasa hareketi olmayan eski tahsil, iade, protesto ve ciro portföy dışıdır", () => {
    expect(portfoydeMi(kayit({ status: "TAHSİL_EDİLDİ", settledAt: null }), SINIR)).toBe(false)
    for (const status of ["İADE_EDİLDİ", "PROTESTOLU", "CİRO_EDİLDİ"]) {
      expect(portfoydeMi(kayit({ status }), SINIR)).toBe(false)
    }
  })
})

describe("kiymetPortfoyu — alınan varlık, verilen borç", () => {
  it("yön çözümü portföy ekranıyla aynı: yön boşsa tedarikçi = verilen", () => {
    const sonuc = kiymetPortfoyu(
      [
        kayit({ amount: "1500.50" }),
        kayit({ direction: "GIVEN", amount: 700 }),
        kayit({ direction: null, supplierId: "s1", amount: 300 }),
        kayit({ direction: null, supplierId: null, amount: 200 }),
      ],
      SINIR,
    )
    expect(sonuc).toEqual({ received: 1700.5, given: 1000 })
  })

  it("bozuk ya da sıfır tutar toplamı kaydırmaz", () => {
    expect(kiymetPortfoyu([kayit({ amount: "abc" }), kayit({ amount: 0 })], SINIR)).toEqual({ received: 0, given: 0 })
  })
})
