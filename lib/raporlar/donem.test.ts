import { describe, expect, it } from "vitest"
import { DEFAULT_PERIOD, percentChange, resolvePeriod } from "./donem"

/**
 * Finansal panonun dönem seçenekleri. Karşılaştırma dönemi TAKVİMSEL olmalı:
 * "aynı gün sayısı kadar geriye git" denseydi 28 günlük şubat, ocakla
 * kıyaslanırken ocağın son üç gününü ikinci kez sayardı.
 */
describe("dönem seçenekleri", () => {
  const eylul5 = new Date(2026, 8, 5)

  it("bu ay: ayın ilk ve son günü, karşılaştırma geçen ay", () => {
    const period = resolvePeriod("bu-ay", eylul5)
    expect(period.startDate).toBe("2026-09-01")
    expect(period.endDate).toBe("2026-09-30")
    expect(period.previous.startDate).toBe("2026-08-01")
    expect(period.previous.endDate).toBe("2026-08-31")
  })

  it("geçen ay: bir önceki ay, karşılaştırma ondan da önceki", () => {
    const period = resolvePeriod("gecen-ay", eylul5)
    expect(period.startDate).toBe("2026-08-01")
    expect(period.endDate).toBe("2026-08-31")
    expect(period.previous.startDate).toBe("2026-07-01")
    expect(period.previous.endDate).toBe("2026-07-31")
  })

  it("bu çeyrek: Eylül 3. çeyrektir (Tem-Eyl), öncesi Nis-Haz", () => {
    const period = resolvePeriod("bu-ceyrek", eylul5)
    expect(period.startDate).toBe("2026-07-01")
    expect(period.endDate).toBe("2026-09-30")
    expect(period.previous.startDate).toBe("2026-04-01")
    expect(period.previous.endDate).toBe("2026-06-30")
  })

  it("bu yıl / geçen yıl tam takvim yılıdır", () => {
    expect(resolvePeriod("bu-yil", eylul5)).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      previous: { startDate: "2025-01-01", endDate: "2025-12-31" },
    })
    expect(resolvePeriod("gecen-yil", eylul5)).toMatchObject({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      previous: { startDate: "2024-01-01", endDate: "2024-12-31" },
    })
  })

  it("yıl sınırını aşar: Ocak'ta geçen ay bir önceki yılın Aralık'ıdır", () => {
    const period = resolvePeriod("gecen-ay", new Date(2026, 0, 15))
    expect(period.startDate).toBe("2025-12-01")
    expect(period.endDate).toBe("2025-12-31")
    expect(period.previous.startDate).toBe("2025-11-01")
  })

  it("1. çeyrekte önceki çeyrek geçen yılın son çeyreğidir", () => {
    const period = resolvePeriod("bu-ceyrek", new Date(2026, 1, 10))
    expect(period.startDate).toBe("2026-01-01")
    expect(period.endDate).toBe("2026-03-31")
    expect(period.previous.startDate).toBe("2025-10-01")
    expect(period.previous.endDate).toBe("2025-12-31")
  })

  it("artık yılın şubatı 29 çeker", () => {
    expect(resolvePeriod("bu-ay", new Date(2028, 1, 3)).endDate).toBe("2028-02-29")
  })

  it("bilinmeyen değer varsayılana düşer — adres çubuğundaki çöp raporu patlatmaz", () => {
    const fallback = resolvePeriod(DEFAULT_PERIOD, eylul5)
    expect(resolvePeriod("nonexistent", eylul5)).toEqual(fallback)
    expect(resolvePeriod(null, eylul5)).toEqual(fallback)
    expect(resolvePeriod("", eylul5)).toEqual(fallback)
  })
})

describe("yüzde değişim", () => {
  it("artış ve azalışı işaretiyle verir", () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
  })

  /** Sıfıra bölünce `Infinity` çıkıyor ve ekranda "%∞ artış" görünüyordu. */
  it("önceki dönem sıfırsa oran yoktur", () => {
    expect(percentChange(1_000, 0)).toBeNull()
    expect(percentChange(0, 0)).toBeNull()
  })

  /** Zarardan kâra geçiş: payda MUTLAK değer, yoksa işaret ters dönerdi. */
  it("önceki dönem zararsa artış pozitif okunur", () => {
    expect(percentChange(50, -100)).toBe(150)
  })
})
