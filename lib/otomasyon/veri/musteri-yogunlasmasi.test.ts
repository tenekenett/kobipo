// K-MUS-07'nin İKİ EŞİĞİ — ikisi de ölçümle seçildi, ikisi de sorgunun dışında.
//
// %40 payı dağılımdan geldi (canlı veride %19 ile %48 arasında boşluk var); "en
// az 5 müşteri" şartı ise 1–2 müşterili altı firmada payın %67–100 çıkmasından.
// Şart kalkarsa kart, tek işi olan hesaba "tek müşteriye bağımlısınız" demeye
// başlar — doğru ama beyhude, ve bunu hiçbir sorgu hatası göstermez.

import { describe, expect, it } from "vitest"
import { yogunlasmaSec, EN_AZ_MUSTERI, ESIK_PAY } from "./musteri-yogunlasmasi"

/** `n` müşterilik taban + tepe müşteri. */
const taban = (n: number, ciro: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, ciro }))

describe("K-MUS-07 eşikleri", () => {
  it("müşteri sayısı yetmiyorsa kart HİÇ çıkmaz", () => {
    // 4 müşteri, biri cironun %90'ı — doğru ama beyhude.
    const az = [{ id: "buyuk", ciro: 900 }, ...taban(3, 33)]
    expect(yogunlasmaSec(az)).toBeNull()
    expect(az.length).toBeLessThan(EN_AZ_MUSTERI)
  })

  it("cirosu SIFIR olan kayıtlar elendikten SONRA da beş müşteri kalmalı", () => {
    // 5 satır var ama biri ₺0: "seçme şansı olan taban" değil.
    const sonuc = yogunlasmaSec([
      { id: "buyuk", ciro: 900 },
      ...taban(3, 33),
      { id: "bos", ciro: 0 },
    ])
    expect(sonuc).toBeNull()
  })

  it("pay eşiğin ALTINDAYSA kart çıkmaz", () => {
    // En büyük %25 → normal dağılım.
    const sonuc = yogunlasmaSec([
      { id: "buyuk", ciro: 250 },
      ...taban(3, 250),
      { id: "x", ciro: 250 },
    ])
    expect(sonuc).toBeNull()
  })

  it("pay eşiği aşınca en büyük müşteri, payı ve toplam ciro döner", () => {
    const sonuc = yogunlasmaSec([
      { id: "buyuk", ciro: 720 },
      ...taban(4, 70),
    ])
    expect(sonuc?.enBuyuk.id).toBe("buyuk")
    expect(sonuc?.toplam).toBe(1_000)
    expect(sonuc?.pay).toBeCloseTo(0.72, 5)
    expect(sonuc!.pay).toBeGreaterThan(ESIK_PAY)
    // Sıralama ciroya göre: ilk üçün payı da buradan hesaplanıyor.
    expect(sonuc?.satirlar[0].id).toBe("buyuk")
  })

  it("Decimal/string gelen ciro sayıya çevrilir", () => {
    const sonuc = yogunlasmaSec([
      { id: "buyuk", ciro: "720.00" },
      ...taban(4, 70),
    ])
    expect(sonuc?.enBuyuk.ciro).toBe(720)
  })
})
