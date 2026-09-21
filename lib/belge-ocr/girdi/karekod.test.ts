import { describe, expect, it } from "vitest"
import { gibKarekoduMu, karekodCoz } from "./karekod"

const ORNEK = JSON.stringify({
  vkntckn: "7352344835",
  avkntckn: "3531285187",
  senaryo: "EARSIVFATURA",
  tip: "SATIS",
  tarih: "2026-09-21",
  no: "RYP2026000000123",
  ettn: "6F1C2A3E-1111-2222-3333-444455556666",
  parabirimi: "TRY",
  malhizmettoplam: 1000,
  "kdvmatrah(20)": 800,
  "hesaplanankdv(20)": 160,
  "kdvmatrah(10)": 200,
  "hesaplanankdv(10)": 20,
  vergidahil: 1180,
  odenecek: 1180,
  toplamiskonto: 0,
})

describe("karekodCoz", () => {
  it("GİB JSON'unu yapılandırır, oran anahtarlarını desenle toplar", () => {
    const k = karekodCoz(ORNEK)
    expect(k?.tur).toBe("GIB")
    if (k?.tur !== "GIB") return
    expect(k.saticiVkn).toBe("7352344835")
    expect(k.aliciVkn).toBe("3531285187")
    expect(k.belgeNo).toBe("RYP2026000000123")
    expect(k.ettn).toBe("6f1c2a3e-1111-2222-3333-444455556666")
    expect(k.kdvKirilimi).toEqual([
      { oran: 10, matrah: 200, kdv: 20 },
      { oran: 20, matrah: 800, kdv: 160 },
    ])
    expect(k.odenecek).toBe(1180)
    // Tanınmayan anahtar atılmaz
    expect(k.diger).toEqual({ toplamiskonto: 0 })
    expect(gibKarekoduMu(k)).toBe(true)
  })

  it("Türkçe biçimli sayı ve büyük harfli anahtar kabul edilir", () => {
    const k = karekodCoz(
      '{"VknTckn":"1234567890","No":"ABC2026000000001","Odenecek":"1.234,56","kdvmatrah(1)":"1.000,00"}'
    )
    if (k?.tur !== "GIB") throw new Error("GIB bekleniyordu")
    expect(k.odenecek).toBe(1234.56)
    expect(k.kdvKirilimi).toEqual([{ oran: 1, matrah: 1000, kdv: null }])
  })

  it("URL ve düz metin GİB sayılmaz", () => {
    expect(karekodCoz("https://ebelge.gib.gov.tr/dogrula?x=1")).toEqual({
      tur: "URL",
      url: "https://ebelge.gib.gov.tr/dogrula?x=1",
    })
    expect(karekodCoz("FATURA 123")?.tur).toBe("BILINMEYEN")
    expect(karekodCoz("")).toBeNull()
    expect(gibKarekoduMu(karekodCoz("[1,2]"))).toBe(false)
  })
})
