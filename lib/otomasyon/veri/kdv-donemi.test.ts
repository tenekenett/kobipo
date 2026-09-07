// K-BLG-07'nin TAKVİMİ — tarayıcıda sınanamayan tek kart mantığı.
//
// Kart yalnız ayın 16–28'i arasında görünüyor. Geliştirme günü (7 Eylül) ekranda
// hiç çıkmadı; yani "tarayıcıda bir kez koştur" denetimi bu kartın takvim
// dalını HİÇ görmüyor. Yanlış bir sınır ancak canlıda, ayın ortasında ve
// muhtemelen yanlış dönemi göstererek ortaya çıkardı.
//
// Sınanan üç şey: pencerenin iki ucu, dönemin GEÇEN ay olması ve yıl geçişi.

import { describe, expect, it } from "vitest"
import { beyanPenceresi, BEYAN_GUNU, UYARI_PENCERESI_GUN } from "./kdv-donemi"

/** İstanbul saatiyle o günün öğlesi — UTC kayması testi bozmasın diye. */
const gun = (iso: string) => new Date(`${iso}T09:00:00Z`)

describe("KDV beyan penceresi", () => {
  it("ayın başında SUSAR — 28'ine iki haftadan fazla varken kart aksiyon değildir", () => {
    expect(beyanPenceresi(gun("2026-09-07"))).toBeNull()
    expect(beyanPenceresi(gun("2026-09-15"))).toBeNull()
  })

  it("pencerenin ilk günü açılır, son günü 28'dir", () => {
    const ilk = beyanPenceresi(gun("2026-09-16"))
    expect(ilk?.kalanGun).toBe(UYARI_PENCERESI_GUN)
    const son = beyanPenceresi(gun("2026-09-28"))
    expect(son?.kalanGun).toBe(0)
  })

  it("28'i geçince susar: o dönemin süresi dolmuştur, sonrakinin sırası gelmemiştir", () => {
    expect(beyanPenceresi(gun("2026-09-29"))).toBeNull()
    expect(beyanPenceresi(gun("2026-09-30"))).toBeNull()
  })

  it("dönem GEÇEN aydır — beyan izleyen ayın 28'inde verilir", () => {
    const p = beyanPenceresi(gun("2026-09-20"))
    expect(p?.donem).toBe("2026-08")
    expect(p?.donemAdi).toBe("Ağustos 2026")
    expect(p?.donemBas.toISOString()).toBe("2026-08-01T00:00:00.000Z")
    // Üst sınır DIŞLAYICI: Eylül'ün ilk günü Ağustos dönemine girmez.
    expect(p?.donemSon.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(p?.beyanTarihi).toBe("28 Eylül")
  })

  it("OCAK'ta dönem geçen yılın ARALIK'ıdır — yıl geçişi elle hesaplanmıyor", () => {
    const p = beyanPenceresi(gun("2027-01-20"))
    expect(p?.donem).toBe("2026-12")
    expect(p?.donemAdi).toBe("Aralık 2026")
    expect(p?.donemBas.toISOString()).toBe("2026-12-01T00:00:00.000Z")
    expect(p?.donemSon.toISOString()).toBe("2027-01-01T00:00:00.000Z")
  })

  it("beyan günü sabiti tek yerde durur (mevzuat değişirse tek satır)", () => {
    expect(BEYAN_GUNU).toBe(28)
  })
})
