/**
 * Yetki çözümünün testleri — "hangi modüller açık" sorusunun cevabı.
 *
 * Kritik nokta hoşgörü süresi: `resolveGrantedModules` yetkiler her yeniden
 * hesaplandığında (reconcile, recurring, süper-admin) çağrılıyor. `PAST_DUE`'yu
 * "kapalı" sayarsa, ödemesi bir gün geciken müşteri hoşgörü süresinin ortasında
 * sessizce kilitlenir — üstelik `reconcile` ona hiç dokunmamış olsa bile.
 */

import { describe, expect, it } from "vitest"
import { GRACE_DAYS_BY_CYCLE } from "./constants"
import { DAY_MS } from "./notice"
import {
  isInGracePeriod,
  isPaidActive,
  isTrialActive,
  periodEndFor,
  resolveGrantedModules,
} from "./entitlements"

const NOW = new Date("2026-08-08T12:00:00.000Z")
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS)

const sub = (over: Record<string, unknown> = {}) => ({
  status: "ACTIVE",
  purchasedModules: ["sales", "stock"],
  trialEndsAt: null,
  periodEnd: inDays(20),
  // Hoşgörü periyoda göre değişir; testin varsayılanı aylık (7 gün).
  billingCycle: "MONTHLY",
  ...over,
}) as Parameters<typeof resolveGrantedModules>[0]

describe("isPaidActive", () => {
  it("ACTIVE ve dönemi sürerken doğru", () => {
    expect(isPaidActive(sub(), NOW)).toBe(true)
  })

  it("dönem bittiyse yanlış", () => {
    expect(isPaidActive(sub({ periodEnd: inDays(-1) }), NOW)).toBe(false)
  })

  it("başka statüde yanlış", () => {
    expect(isPaidActive(sub({ status: "PAST_DUE" }), NOW)).toBe(false)
    expect(isPaidActive(null, NOW)).toBe(false)
  })
})

describe("isInGracePeriod", () => {
  it("PAST_DUE ve hoşgörü sürerken doğru", () => {
    expect(isInGracePeriod(sub({ status: "PAST_DUE", periodEnd: inDays(-1) }), NOW)).toBe(true)
  })

  it("hoşgörü dolunca yanlış", () => {
    const outside = sub({ status: "PAST_DUE", periodEnd: inDays(-GRACE_DAYS_BY_CYCLE.MONTHLY - 1) })
    expect(isInGracePeriod(outside, NOW)).toBe(false)
  })

  it("yalnız PAST_DUE için geçerli", () => {
    // EXPIRED bir aboneliğe hoşgörü tanımak, kilitlenmiş hesabı geri açardı.
    expect(isInGracePeriod(sub({ status: "EXPIRED", periodEnd: inDays(-1) }), NOW)).toBe(false)
    expect(isInGracePeriod(sub({ status: "ACTIVE", periodEnd: inDays(-1) }), NOW)).toBe(false)
    expect(isInGracePeriod(sub({ status: "PAST_DUE", periodEnd: null }), NOW)).toBe(false)
  })

  it("YILLIK abonelikte hoşgörü daha uzun (15 gün)", () => {
    // Bu testin asıl işi bir regresyonu tutmak: `billingCycle` select'ten düşerse ya da
    // tip kaybolursa yıllık müşteri aylık süreyle ölçülür ve 8 gün erken kilitlenir.
    const gunTen = { status: "PAST_DUE", periodEnd: inDays(-10) }
    expect(isInGracePeriod(sub({ ...gunTen, billingCycle: "YEARLY" }), NOW)).toBe(true)
    expect(isInGracePeriod(sub({ ...gunTen, billingCycle: "MONTHLY" }), NOW)).toBe(false)
    expect(
      isInGracePeriod(sub({ status: "PAST_DUE", periodEnd: inDays(-16), billingCycle: "YEARLY" }), NOW),
    ).toBe(false)
  })

  it("periyodu bilinmeyen satırda UZUN süre varsayılır", () => {
    // Erken kilitlemek, fazladan birkaç gün erişim vermekten pahalıdır: ödemiş müşteriyi
    // kapı dışında bırakır. Bkz. constants.ts → DEFAULT_GRACE_DAYS.
    const belirsiz = sub({ status: "PAST_DUE", periodEnd: inDays(-10), billingCycle: null })
    expect(isInGracePeriod(belirsiz, NOW)).toBe(true)
  })
})

describe("resolveGrantedModules", () => {
  it("ücretli aktifte satın alınanlar açılır", () => {
    expect([...resolveGrantedModules(sub(), NOW)].sort()).toEqual(["sales", "stock"])
  })

  it("hoşgörü süresinde erişim SÜRER", () => {
    const grace = sub({ status: "PAST_DUE", periodEnd: inDays(-2) })
    expect([...resolveGrantedModules(grace, NOW)].sort()).toEqual(["sales", "stock"])
  })

  it("hoşgörü dolunca hiçbiri", () => {
    const late = sub({ status: "PAST_DUE", periodEnd: inDays(-GRACE_DAYS_BY_CYCLE.MONTHLY - 1) })
    expect(resolveGrantedModules(late, NOW)).toEqual([])
  })

  it("deneme modül vermez", () => {
    // Modül yalnızca satın almayla açılır (bkz. docs/paket-abonelik/MODUL-KILIDI.md).
    const trial = sub({ status: "TRIAL", trialEndsAt: inDays(300), periodEnd: inDays(300) })
    expect(resolveGrantedModules(trial, NOW)).toEqual([])
  })

  it("abonelik yoksa hiçbiri", () => {
    expect(resolveGrantedModules(null, NOW)).toEqual([])
    expect(resolveGrantedModules(sub({ status: "EXPIRED" }), NOW)).toEqual([])
  })

  it("bağımlılıklar tamamlanır", () => {
    // Restoran & Kafe alındıysa Stok da açılmalı; arayüz atlansa bile DB tutarlı kalsın.
    const resto = sub({ purchasedModules: ["restaurant"] })
    expect([...resolveGrantedModules(resto, NOW)].sort()).toEqual(["restaurant", "stock"])
  })

  it("bilinmeyen anahtar elenir", () => {
    expect(resolveGrantedModules(sub({ purchasedModules: ["yok"] }), NOW)).toEqual([])
  })
})

describe("isTrialActive", () => {
  it("TRIAL ve süresi dolmamışsa doğru", () => {
    expect(isTrialActive(sub({ status: "TRIAL", trialEndsAt: inDays(10) }), NOW)).toBe(true)
    expect(isTrialActive(sub({ status: "TRIAL", trialEndsAt: inDays(-1) }), NOW)).toBe(false)
  })
})

describe("periodEndFor", () => {
  it("aylık ve yıllık dönem sonu", () => {
    const start = new Date("2026-01-31T00:00:00.000Z")
    expect(periodEndFor("YEARLY", start).getUTCFullYear()).toBe(2027)
  })

  it("ay sonunda taşmaz, ayın son gününe kırpar", () => {
    // BİLEREK DEĞİŞTİRİLDİ (2026-08-27): önceki ham `setMonth` davranışı 31 Ocak + 1 ay =
    // 3 Mart üretiyordu, yani ay sonunda ödeyen müşteriye sessizce 2-3 gün fazla. Kural
    // artık lib/billing/period.ts'te tek yerde ve elle süre verme de onu kullanıyor.
    const jan31 = new Date(2026, 0, 31)
    const end = periodEndFor("MONTHLY", jan31)
    expect(end.getMonth()).toBe(1) // Şubat
    expect(end.getDate()).toBe(28)
  })
})
