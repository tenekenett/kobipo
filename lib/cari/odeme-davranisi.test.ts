import { describe, expect, it } from "vitest"
import { davranisEtiketi, odemeDavranisiHesapla } from "./odeme-davranisi"

const g = (gun: number) => new Date(2026, 0, gun)
const BUGUN = new Date(2026, 2, 1) // 1 Mart 2026

describe("ödeme davranışı — FIFO", () => {
  it("tahsilatı en eski faturadan mahsup eder ve gün ortalamasını çıkarır", () => {
    const d = odemeDavranisiHesapla(
      [
        { tarih: g(1), tutar: 10_000 },
        { tarih: g(11), tutar: 10_000 },
      ],
      [
        { tarih: g(11), tutar: 10_000 }, // ilk faturaya → 10 gün
        { tarih: g(31), tutar: 10_000 }, // ikinci faturaya → 20 gün
      ],
      BUGUN
    )
    expect(d).not.toBeNull()
    expect(d!.gunOrtalama).toBe(15)
    expect(d!.eslesenTutar).toBe(20_000)
    expect(d!.olaySayisi).toBe(2)
    expect(d!.acikTutar).toBe(0)
    expect(d!.enEskiAcikGun).toBeNull()
  })

  /**
   * Ortalama LİRAYLA ağırlıklandırılır: büyük fatura küçük faturadan daha çok
   * söz sahibidir. Düz ortalama alınsaydı 1.000 TL'lik peşin satış, 100.000
   * TL'lik geç ödemeyi dengelerdi.
   */
  it("ortalama tutarla ağırlıklandırılır", () => {
    const d = odemeDavranisiHesapla(
      [
        { tarih: g(1), tutar: 90_000 },
        { tarih: g(1), tutar: 10_000 },
      ],
      [
        { tarih: g(11), tutar: 90_000 }, // 10 gün · 90.000
        { tarih: g(101), tutar: 10_000 }, // 100 gün · 10.000
      ],
      BUGUN
    )
    // (90.000×10 + 10.000×100) / 100.000 = 19
    expect(d!.gunOrtalama).toBe(19)
  })

  it("kısmi ödeme de davranışa girer, tam kapanma şartı yoktur", () => {
    const d = odemeDavranisiHesapla(
      [{ tarih: g(1), tutar: 100_000 }],
      [
        { tarih: g(11), tutar: 30_000 },
        { tarih: g(21), tutar: 30_000 },
      ],
      BUGUN
    )
    expect(d).not.toBeNull()
    expect(d!.eslesenTutar).toBe(60_000)
    expect(d!.acikTutar).toBe(40_000)
    // Fatura 1 Ocak, bugün 1 Mart → 59 gün
    expect(d!.enEskiAcikGun).toBe(59)
  })

  it("faturadan önce gelen para negatif gün verir (avans)", () => {
    const d = odemeDavranisiHesapla(
      [{ tarih: g(21), tutar: 20_000 }],
      [
        { tarih: g(1), tutar: 10_000 },
        { tarih: g(11), tutar: 10_000 },
      ],
      BUGUN
    )
    expect(d!.gunOrtalama).toBe(-15)
  })

  /** "Veri yok" ile "0 gün" ayrı şeylerdir; kapı altında null döner. */
  it("olay ya da tutar eşiğinin altında profil kurmaz", () => {
    expect(
      odemeDavranisiHesapla([{ tarih: g(1), tutar: 50_000 }], [{ tarih: g(5), tutar: 50_000 }], BUGUN)
    ).toBeNull() // tek olay
    expect(
      odemeDavranisiHesapla(
        [{ tarih: g(1), tutar: 5_000 }],
        [
          { tarih: g(3), tutar: 500 },
          { tarih: g(5), tutar: 500 },
        ],
        BUGUN
      )
    ).toBeNull() // tutar küçük
    expect(odemeDavranisiHesapla([], [{ tarih: g(1), tutar: 90_000 }], BUGUN)).toBeNull()
    expect(odemeDavranisiHesapla([{ tarih: g(1), tutar: 90_000 }], [], BUGUN)).toBeNull()
  })

  it("fazla ödeme ileriye taşınmaz", () => {
    const d = odemeDavranisiHesapla(
      [{ tarih: g(1), tutar: 20_000 }],
      [
        { tarih: g(11), tutar: 15_000 },
        { tarih: g(11), tutar: 50_000 }, // 5.000'i eşleşir, 45.000 artar
      ],
      BUGUN
    )
    expect(d!.eslesenTutar).toBe(20_000)
    expect(d!.acikTutar).toBe(0)
  })

  it("bozuk tarih ve tutar elenir", () => {
    const d = odemeDavranisiHesapla(
      [
        { tarih: "gecersiz", tutar: 50_000 },
        { tarih: g(1), tutar: 20_000 },
        { tarih: g(2), tutar: -5 },
      ],
      [
        { tarih: g(11), tutar: 10_000 },
        { tarih: g(21), tutar: 10_000 },
      ],
      BUGUN
    )
    expect(d!.eslesenTutar).toBe(20_000)
  })
})

describe("davranış etiketi", () => {
  /**
   * Eşikler gecikme skorununkilerden AYRI: burada 0 gün "peşin", 30 gün normal
   * bir vadeli çalışma. Gecikme eşikleri kullanılsaydı 30 günde ödeyen müşteri
   * "Riskli" görünürdü.
   */
  it("ödeme süresine göre etiketler", () => {
    expect(davranisEtiketi(-10)).toBe("Peşin/avans")
    expect(davranisEtiketi(0)).toBe("Peşin/avans")
    expect(davranisEtiketi(11)).toBe("Hızlı ödüyor")
    expect(davranisEtiketi(30)).toBe("Ortalama")
    expect(davranisEtiketi(60)).toBe("Yavaş ödüyor")
  })
})
