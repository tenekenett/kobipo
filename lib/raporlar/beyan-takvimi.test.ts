// Vergi raporu sayfasının takvim şeridi — seçilen dönemin son günleri.
// (Sıradaki dönem mantığı `lib/otomasyon/veri/kdv-donemi.test.ts`te sınanıyor.)

import { describe, expect, it } from "vitest"
import { BEYAN_GUNU, MUHTASAR_GUNU, beyanSonGunu, beyanTarihi } from "./beyan-takvimi"

/** İstanbul saatiyle o günün öğlesi — UTC kayması testi bozmasın diye. */
const gun = (iso: string) => new Date(`${iso}T09:00:00Z`)

describe("Beyan takvimi", () => {
  it("son günler izleyen ayın 26'sı (muhtasar) ve 28'i (KDV)", () => {
    expect(MUHTASAR_GUNU).toBe(26)
    expect(BEYAN_GUNU).toBe(28)
    const kdv = beyanTarihi(2026, 9, BEYAN_GUNU, gun("2026-10-01"))
    expect(kdv).toEqual({ tarih: "28 Ekim", haftaGunu: "Çarşamba", kaydirildi: false, kalanGun: 27 })
    const muh = beyanTarihi(2026, 9, MUHTASAR_GUNU, gun("2026-10-01"))
    expect(muh).toEqual({ tarih: "26 Ekim", haftaGunu: "Pazartesi", kaydirildi: false, kalanGun: 25 })
  })

  it("hafta sonuna düşen son gün Pazartesi'ye kayar — iki beyanda da", () => {
    // 28 Kasım 2026 Cumartesi → 30 Kasım; 26 Eylül 2026 Cumartesi → 28 Eylül.
    expect(beyanTarihi(2026, 10, BEYAN_GUNU, gun("2026-11-01"))).toMatchObject({
      tarih: "30 Kasım",
      haftaGunu: "Pazartesi",
      kaydirildi: true,
    })
    expect(beyanTarihi(2026, 8, MUHTASAR_GUNU, gun("2026-09-01"))).toMatchObject({
      tarih: "28 Eylül",
      kaydirildi: true,
    })
  })

  it("Aralık dönemi gelecek yılın Ocak'ına düşer", () => {
    const { tarih } = beyanSonGunu(2026, 12, BEYAN_GUNU)
    expect(tarih.toISOString()).toBe("2027-01-28T00:00:00.000Z")
  })

  it("geçmiş dönemde kalan gün eksidir (ekran 'süresi geçti' yazar)", () => {
    expect(beyanTarihi(2026, 7, BEYAN_GUNU, gun("2026-10-01")).kalanGun).toBeLessThan(0)
    expect(beyanTarihi(2026, 8, BEYAN_GUNU, gun("2026-09-28")).kalanGun).toBe(0)
  })
})
