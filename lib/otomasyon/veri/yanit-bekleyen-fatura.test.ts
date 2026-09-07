// K-BLG-08'in SÜRE HESABI — kartın tek hukuki iddiası.
//
// Kart "8 gün içinde red yanıtı verilmezse fatura kabul edilmiş sayılır" diyor.
// Bu cümlenin arkasındaki aritmetik yanlışsa kullanıcıya olmayan bir süre
// gösterilir — ve tarayıcıda görünen tek şey makul bir sayı olur. Ölçüm bunu
// yakalayamaz; test yakalar.

import { describe, expect, it } from "vitest"
import { yanitBekleyenSec, YANIT_SURESI_GUN, type HamKayit } from "./yanit-bekleyen-fatura"

const BUGUN = new Date("2026-09-07T09:00:00Z")
const gunOnce = (n: number) => new Date(BUGUN.getTime() - n * 86_400_000)

const belge = (over: Partial<HamKayit> & { uuid: string; yas: number }): HamKayit => ({
  invoiceNo: `FT-${over.uuid}`,
  senderName: "Gönderen A.Ş.",
  docDate: gunOnce(over.yas),
  payableAmount: 1_000,
  currencyCode: "TRY",
  ...over,
})

describe("K-BLG-08 yanıt süresi", () => {
  it("süre BELGE tarihinden işler; 8. gün son gündür", () => {
    const bugunGelen = yanitBekleyenSec([belge({ uuid: "a", yas: 0 })], BUGUN)
    expect(bugunGelen?.ornekler[0].kalanGun).toBe(YANIT_SURESI_GUN)

    const sonGun = yanitBekleyenSec([belge({ uuid: "b", yas: YANIT_SURESI_GUN })], BUGUN)
    expect(sonGun?.ornekler[0].kalanGun).toBe(0)
    expect(sonGun?.acikAdet).toBe(1)
    expect(sonGun?.gecmisAdet).toBe(0)
  })

  it("9. günde süre DOLMUŞ sayılır — kartın dili burada değişiyor", () => {
    const o = yanitBekleyenSec([belge({ uuid: "c", yas: YANIT_SURESI_GUN + 1 })], BUGUN)
    expect(o?.ornekler[0].kalanGun).toBe(-1)
    expect(o?.acikAdet).toBe(0)
    expect(o?.gecmisAdet).toBe(1)
    // Süresi dolmuşta "en yakın kalan" diye bir şey yoktur.
    expect(o?.enYakinKalan).toBeNull()
  })

  it("SÜRESİ İŞLEYEN belgeler önce sıralanır — aksiyonu olan onlar", () => {
    const o = yanitBekleyenSec(
      [
        belge({ uuid: "eski", yas: 100 }),
        belge({ uuid: "acil", yas: 7 }),
        belge({ uuid: "rahat", yas: 2 }),
      ],
      BUGUN
    )
    expect(o?.ornekler.map((f) => f.uuid)).toEqual(["acil", "rahat", "eski"])
    expect(o?.enYakinKalan).toBe(1)
  })

  it("döviz faturası SAYILIR ama TL toplamına girmez (K-BLG-01 ile aynı kural)", () => {
    const o = yanitBekleyenSec(
      [
        belge({ uuid: "tl", yas: 3, payableAmount: 5_000 }),
        belge({ uuid: "usd", yas: 3, payableAmount: 1_000, currencyCode: "USD" }),
      ],
      BUGUN
    )
    expect(o?.adet).toBe(2)
    expect(o?.dovizAdet).toBe(1)
    expect(o?.tutarTL).toBe(5_000)
  })

  it("ekran dönemi EN ESKİ belgeyi kapsayan en dar hazır pencere olur", () => {
    // Ekranın seçenekleri 7/30/90/180/365; 117 günlük belge 180'i gerektirir.
    const o = yanitBekleyenSec([belge({ uuid: "a", yas: 117 })], BUGUN)
    expect(o?.ekranDonemi).toBe(180)
    const yakin = yanitBekleyenSec([belge({ uuid: "b", yas: 5 })], BUGUN)
    expect(yakin?.ekranDonemi).toBe(7)
  })
})
