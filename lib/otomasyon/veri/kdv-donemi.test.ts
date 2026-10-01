// K-BLG-07'nin TAKVİMİ — tarayıcıda sınanamayan tek kart mantığı.
//
// Kart yalnız ayın 16–28'i arasında görünüyor. Geliştirme günü (7 Eylül) ekranda
// hiç çıkmadı; yani "tarayıcıda bir kez koştur" denetimi bu kartın takvim
// dalını HİÇ görmüyor. Yanlış bir sınır ancak canlıda, ayın ortasında ve
// muhtemelen yanlış dönemi göstererek ortaya çıkardı.
//
// Sınanan üç şey: pencerenin iki ucu, dönemin GEÇEN ay olması ve yıl geçişi.

import { describe, expect, it } from "vitest"
import { beyanPenceresi, BEYAN_GUNU, siradakiBeyan, UYARI_PENCERESI_GUN } from "./kdv-donemi"

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

  it("hafta sonu kayması pencereyi de öteler: 28'i Cumartesi olan ayın 29'unda kart açık", () => {
    const p = beyanPenceresi(gun("2026-11-29"))
    expect(p?.donem).toBe("2026-10")
    expect(p?.kalanGun).toBe(1)
    expect(p?.beyanTarihi).toBe("30 Kasım")
    // Pencere son günden 12 gün önce açılır — 28'inden değil.
    expect(beyanPenceresi(gun("2026-11-18"))?.kalanGun).toBe(UYARI_PENCERESI_GUN)
    expect(beyanPenceresi(gun("2026-11-17"))).toBeNull()
    expect(beyanPenceresi(gun("2026-12-01"))).toBeNull()
  })

  it("beyan günü sabiti tek yerde durur (mevzuat değişirse tek satır)", () => {
    expect(BEYAN_GUNU).toBe(28)
  })
})

// Panodaki KDV kartının dönemi. Pencereden farkı: her gün bir dönem gösterir.
describe("Sıradaki KDV beyanı (pano kartı)", () => {
  it("ayın 1–28'i arası dönem GEÇEN aydır, beyanı bu ayın 28'inde", () => {
    const b = siradakiBeyan(gun("2026-09-07"))
    expect(b.donem).toBe("2026-08")
    expect(b.donemAdi).toBe("Ağustos 2026")
    expect(b.beyanTarihi).toBe("28 Eylül")
    expect(b.kalanGun).toBe(21)
    expect(b.devamEdiyor).toBe(false)
    expect(b.buAy).toEqual({ yil: 2026, ay: 9, adi: "Eylül 2026" })
  })

  it("28'i son gündür: kalan 0, dönem hâlâ geçen ay", () => {
    const b = siradakiBeyan(gun("2026-09-28"))
    expect(b.donem).toBe("2026-08")
    expect(b.kalanGun).toBe(0)
  })

  it("28'i geçince sıra içinde bulunulan aya geçer, beyanı gelecek ayın 28'inde", () => {
    const b = siradakiBeyan(gun("2026-09-30"))
    expect(b.donem).toBe("2026-09")
    expect(b.donemAdi).toBe("Eylül 2026")
    expect(b.beyanTarihi).toBe("28 Ekim")
    expect(b.kalanGun).toBe(28)
    expect(b.devamEdiyor).toBe(true)
  })

  it("Aralık'ın 29'undan sonra beyan yeni yılın Ocak'ına düşer", () => {
    const b = siradakiBeyan(gun("2026-12-30"))
    expect(b.donem).toBe("2026-12")
    expect(b.beyanTarihi).toBe("28 Ocak")
    expect(b.kalanGun).toBe(29)
  })

  it("Ocak'ın ilk günlerinde dönem geçen yılın Aralık'ıdır", () => {
    const b = siradakiBeyan(gun("2027-01-05"))
    expect(b.yil).toBe(2026)
    expect(b.ay).toBe(12)
    expect(b.donemAdi).toBe("Aralık 2026")
    expect(b.buAy.adi).toBe("Ocak 2027")
  })

  it("28'i Cumartesi ise son gün Pazartesi'dir; 29'unda dönem hâlâ geçen ay", () => {
    // 28 Kasım 2026 Cumartesi → 30 Kasım Pazartesi.
    const b = siradakiBeyan(gun("2026-11-29"))
    expect(b.donem).toBe("2026-10")
    expect(b.beyanTarihi).toBe("30 Kasım")
    expect(b.kaydirildi).toBe(true)
    expect(b.kalanGun).toBe(1)
    expect(b.devamEdiyor).toBe(false)
    expect(siradakiBeyan(gun("2026-11-30")).kalanGun).toBe(0)
    // Pazartesi geçince sıra Kasım'a geçer.
    const sonra = siradakiBeyan(gun("2026-12-01"))
    expect(sonra.donem).toBe("2026-11")
    expect(sonra.beyanTarihi).toBe("28 Aralık")
    expect(sonra.kaydirildi).toBe(false)
  })

  it("28 Şubat Pazar ise Ocak'ın son günü Mart'a taşar — 1 Mart'ta dönem hâlâ Ocak", () => {
    const b = siradakiBeyan(gun("2027-03-01"))
    expect(b.donem).toBe("2027-01")
    expect(b.beyanTarihi).toBe("1 Mart")
    expect(b.kalanGun).toBe(0)
    expect(b.devamEdiyor).toBe(false)
    // Ertesi gün Şubat'ın sırası: 28 Mart 2027 de Pazar → 29 Mart.
    const sonra = siradakiBeyan(gun("2027-03-02"))
    expect(sonra.donem).toBe("2027-02")
    expect(sonra.beyanTarihi).toBe("29 Mart")
  })

  it("İstanbul gece yarısını UTC'den önce geçer: 28'ini 29'una bağlayan gece dönem değişir", () => {
    // 28 Eylül 21:30 UTC = 29 Eylül 00:30 İstanbul → sıra Eylül dönemine geçmiş olmalı.
    expect(siradakiBeyan(new Date("2026-09-28T21:30:00Z")).donem).toBe("2026-09")
    expect(siradakiBeyan(new Date("2026-09-28T20:30:00Z")).donem).toBe("2026-08")
  })
})
