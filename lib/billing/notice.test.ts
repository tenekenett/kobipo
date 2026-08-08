/**
 * Abonelik bitiş uyarısının testleri.
 *
 * Buradaki hatalar iki yönde de pahalı: uyarmazsak müşteri sebepsiz kilitlenir,
 * fazla uyarırsak her gün "aboneliğiniz bitiyor" e-postası gider. Testler bu yüzden
 * gün sınırlarına ve durum geçişlerine bakıyor.
 */

import { describe, expect, it } from "vitest"
import { GRACE_PERIOD_DAYS } from "./constants"
import {
  DAY_MS,
  EMAIL_THRESHOLD_DAYS,
  NOTICE_WARN_DAYS,
  reconcileAction,
  shouldEmailToday,
  subscriptionNotice,
} from "./notice"

const NOW = new Date("2026-08-08T12:00:00.000Z")
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS)

const sub = (over: Partial<Parameters<typeof subscriptionNotice>[0] & object> = {}) => ({
  status: "ACTIVE",
  periodEnd: inDays(30),
  cancelAtPeriodEnd: false,
  ...over,
})

describe("subscriptionNotice", () => {
  it("uzak bitişte uyarı yok", () => {
    expect(subscriptionNotice(sub(), NOW)).toBeNull()
    expect(subscriptionNotice(sub({ periodEnd: inDays(NOTICE_WARN_DAYS + 1) }), NOW)).toBeNull()
  })

  it("pencereye girince uyarır", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(NOTICE_WARN_DAYS) }), NOW)
    expect(notice?.kind).toBe("expiring")
    expect(notice?.daysLeft).toBe(NOTICE_WARN_DAYS)
  })

  it("bitiş anını geçince 'expired' olur", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-1) }), NOW)
    expect(notice?.kind).toBe("expired")
    expect(notice?.daysLeft).toBeLessThanOrEqual(0)
  })

  it("aboneliksiz ya da tarihsiz hesapta uyarı yok", () => {
    expect(subscriptionNotice(null, NOW)).toBeNull()
    expect(subscriptionNotice(undefined, NOW)).toBeNull()
    expect(subscriptionNotice(sub({ periodEnd: null }), NOW)).toBeNull()
  })

  it("deneme uyarılmaz", () => {
    // Deneme modül vermiyor (resolveGrantedModules) — o hesap zaten LockedAccount görüyor,
    // "aboneliğiniz bitiyor" demek yanıltıcı olurdu.
    expect(subscriptionNotice(sub({ status: "TRIAL", periodEnd: inDays(1) }), NOW)).toBeNull()
  })

  it("iptal edilmiş abonelikte kalan süre yine gösterilir", () => {
    const notice = subscriptionNotice(sub({ status: "CANCELLED", periodEnd: inDays(3) }), NOW)
    expect(notice?.kind).toBe("expiring")
    expect(notice?.cancelling).toBe(true)
  })

  it("dönem sonunda iptal işareti metni sertleştirir", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(2), cancelAtPeriodEnd: true }), NOW)
    expect(notice?.cancelling).toBe(true)
  })

  it("EXPIRED statüsü tarih ileride olsa bile bitmiş sayılır", () => {
    // reconcile bir kez EXPIRED yazdıysa erişim kapanmıştır; periodEnd'e bakılmaz.
    const notice = subscriptionNotice(sub({ status: "EXPIRED", periodEnd: inDays(5) }), NOW)
    expect(notice?.kind).toBe("expired")
    expect(notice?.daysLeft).toBeLessThanOrEqual(0)
  })

  it("PAST_DUE aktif gibi uyarılır", () => {
    expect(subscriptionNotice(sub({ status: "PAST_DUE", periodEnd: inDays(2) }), NOW)?.kind).toBe(
      "expiring"
    )
  })
})

describe("locksAt — modüllerin gerçekten kapanacağı an", () => {
  it("ödenmemiş abonelikte dönem bitişinden SONRA", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-1) }), NOW)!
    expect(notice.locksAt.getTime()).toBe(notice.endsAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS)
  })

  it("iptal edilmişse hoşgörü yok — dönem bitişiyle aynı", () => {
    // Kullanıcı bitmesini kendisi istedi; ek süre vermek onu şaşırtır.
    const notice = subscriptionNotice(sub({ periodEnd: inDays(2), cancelAtPeriodEnd: true }), NOW)!
    expect(notice.locksAt.getTime()).toBe(notice.endsAt.getTime())
  })

  it("EXPIRED zaten kapanmış — hoşgörü eklenmez", () => {
    const notice = subscriptionNotice(sub({ status: "EXPIRED", periodEnd: inDays(-30) }), NOW)!
    expect(notice.locksAt.getTime()).toBe(notice.endsAt.getTime())
  })
})

describe("reconcileAction", () => {
  it("dönemi biten ücretli abonelik önce hoşgörüye alınır, kilitlenmez", () => {
    // Aşama 2'nin bütün mesele bu: periodEnd'de ANINDA kilit, ödeme yapan müşteriyi
    // kapı dışında bırakıyordu.
    expect(reconcileAction(sub({ periodEnd: inDays(-1) }), NOW)).toBe("past_due")
  })

  it("dönemi bitmemiş abonelike dokunulmaz", () => {
    expect(reconcileAction(sub({ periodEnd: inDays(5) }), NOW)).toBeNull()
  })

  it("hoşgörü dolunca kilitlenir", () => {
    const justInside = sub({ status: "PAST_DUE", periodEnd: inDays(-GRACE_PERIOD_DAYS + 0.5) })
    const justOutside = sub({ status: "PAST_DUE", periodEnd: inDays(-GRACE_PERIOD_DAYS - 0.5) })
    expect(reconcileAction(justInside, NOW)).toBeNull()
    expect(reconcileAction(justOutside, NOW)).toBe("expire")
  })

  it("iptal edilmiş abonelik hoşgörüsüz kilitlenir", () => {
    expect(reconcileAction(sub({ periodEnd: inDays(-1), cancelAtPeriodEnd: true }), NOW)).toBe("expire")
    expect(reconcileAction(sub({ status: "CANCELLED", periodEnd: inDays(-1) }), NOW)).toBe("expire")
    // Dönem sürerken iptal işareti varken bile erken kapatılmaz.
    expect(reconcileAction(sub({ status: "CANCELLED", periodEnd: inDays(3) }), NOW)).toBeNull()
  })

  it("süresi dolan deneme kilitlenir (demo hesap da bu yolla kapanır)", () => {
    expect(reconcileAction({ status: "TRIAL", periodEnd: null, trialEndsAt: inDays(-1) }, NOW)).toBe("expire")
    expect(reconcileAction({ status: "TRIAL", periodEnd: null, trialEndsAt: inDays(1) }, NOW)).toBeNull()
  })

  it("tarihsiz veya zaten kapalı satırda iş yok", () => {
    expect(reconcileAction(sub({ periodEnd: null }), NOW)).toBeNull()
    expect(reconcileAction(sub({ status: "EXPIRED", periodEnd: inDays(-99) }), NOW)).toBeNull()
  })

  it("idempotent: kilitlenen satır tekrar koşuda iş üretmez", () => {
    // reconcile aynı gün iki kez koşabilir; ikinci koşu EXPIRED'ı görüp durmalı.
    const past = sub({ status: "PAST_DUE", periodEnd: inDays(-GRACE_PERIOD_DAYS - 1) })
    expect(reconcileAction(past, NOW)).toBe("expire")
    expect(reconcileAction({ ...past, status: "EXPIRED" }, NOW)).toBeNull()
  })
})

describe("shouldEmailToday", () => {
  it("yalnız eşik günlerde gönderir", () => {
    for (const days of EMAIL_THRESHOLD_DAYS) {
      expect(shouldEmailToday(subscriptionNotice(sub({ periodEnd: inDays(days) }), NOW))).toBe(true)
    }
    // 5 ve 2 gün eşik değil — pencere içinde ama e-posta yok (banner zaten görünüyor).
    expect(shouldEmailToday(subscriptionNotice(sub({ periodEnd: inDays(5) }), NOW))).toBe(false)
    expect(shouldEmailToday(subscriptionNotice(sub({ periodEnd: inDays(2) }), NOW))).toBe(false)
  })

  it("bitmiş abonelikte her gün tekrar etmez", () => {
    // Bitiş günü ve (cron kaçarsa) ertesi gün gönderilir; üçüncü gün susar.
    expect(shouldEmailToday(subscriptionNotice(sub({ periodEnd: inDays(-0.5) }), NOW))).toBe(true)
    expect(shouldEmailToday(subscriptionNotice(sub({ periodEnd: inDays(-1.5) }), NOW))).toBe(true)
    expect(shouldEmailToday(subscriptionNotice(sub({ periodEnd: inDays(-10) }), NOW))).toBe(false)
  })

  it("uyarı yoksa göndermez", () => {
    expect(shouldEmailToday(null)).toBe(false)
  })
})
