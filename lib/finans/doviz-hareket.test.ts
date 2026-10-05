import { describe, expect, it } from "vitest"
import { hareketKuru } from "./doviz-hareket"

const simdi = new Date("2026-10-05T10:00:00Z")
const temel = { istekKuru: undefined, tarih: simdi, simdi, tcmb: { USD: 34.12, EUR: 37.5 }, cariBagli: false }

describe("hareketKuru", () => {
  it("TRY hesapta kur yok; istemcinin gönderdiği para birimi değil hesabınki geçer", () => {
    expect(hareketKuru({ ...temel, hesapParaBirimi: "TRY" })).toEqual({ ok: true, paraBirimi: "TRY", kur: null, kaynak: "yok" })
    expect(hareketKuru({ ...temel, hesapParaBirimi: null })).toMatchObject({ ok: true, paraBirimi: "TRY" })
  })
  it("dövizli hesapta istekteki kur, yoksa bugünün TCMB kuru", () => {
    expect(hareketKuru({ ...temel, hesapParaBirimi: "usd", istekKuru: "33,5" })).toEqual({ ok: true, paraBirimi: "USD", kur: 33.5, kaynak: "istek" })
    expect(hareketKuru({ ...temel, hesapParaBirimi: "USD" })).toEqual({ ok: true, paraBirimi: "USD", kur: 34.12, kaynak: "tcmb" })
  })
  it("geçmiş günün kuru TCMB'den tahmin edilmez; GBP gibi servisin bilmediği dövizde de kur istenir", () => {
    expect(hareketKuru({ ...temel, hesapParaBirimi: "USD", tarih: new Date("2026-09-01") })).toMatchObject({ ok: false })
    expect(hareketKuru({ ...temel, hesapParaBirimi: "GBP" })).toMatchObject({ ok: false })
    expect(hareketKuru({ ...temel, hesapParaBirimi: "USD", tcmb: null })).toMatchObject({ ok: false })
  })
  it("bozuk kur reddedilir", () => {
    expect(hareketKuru({ ...temel, hesapParaBirimi: "USD", istekKuru: "0" })).toMatchObject({ ok: false })
    expect(hareketKuru({ ...temel, hesapParaBirimi: "USD", istekKuru: "abc" })).toMatchObject({ ok: false })
  })
  it("dövizli hesapta cariye/faturaya bağlı hareket reddedilir (cari bakiye TL)", () => {
    expect(hareketKuru({ ...temel, hesapParaBirimi: "EUR", cariBagli: true, istekKuru: 37 })).toMatchObject({ ok: false })
    // TRY hesapta cari bağı serbest.
    expect(hareketKuru({ ...temel, hesapParaBirimi: "TRY", cariBagli: true })).toMatchObject({ ok: true })
  })
  it("para birimi farklı hesaplar arası virman reddedilir; aynı dövizde serbest", () => {
    expect(hareketKuru({ ...temel, hesapParaBirimi: "USD", virmanHedefParaBirimi: "TRY", istekKuru: 34 })).toMatchObject({ ok: false })
    expect(hareketKuru({ ...temel, hesapParaBirimi: "TRY", virmanHedefParaBirimi: "USD" })).toMatchObject({ ok: false })
    expect(hareketKuru({ ...temel, hesapParaBirimi: "USD", virmanHedefParaBirimi: "USD", istekKuru: 34 })).toMatchObject({ ok: true, kur: 34 })
  })
})
