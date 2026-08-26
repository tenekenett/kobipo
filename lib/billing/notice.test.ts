/**
 * Abonelik bitiş uyarısının testleri.
 *
 * Buradaki hatalar iki yönde de pahalı: uyarmazsak müşteri sebepsiz kilitlenir,
 * fazla uyarırsak her gün "aboneliğiniz bitiyor" e-postası gider. Testler bu yüzden
 * gün sınırlarına, durum geçişlerine ve eşik durumuna bakıyor.
 */

import { describe, expect, it } from "vitest"
import { GRACE_DAYS_BY_CYCLE } from "./constants"
import {
  DAY_MS,
  EMAIL_THRESHOLD_DAYS,
  EXPIRED_THRESHOLD,
  GRACE_THRESHOLD,
  isAutoRenewActive,
  NOTICE_WARN_DAYS,
  pendingNoticeThreshold,
  reconcileAction,
  subscriptionNotice,
} from "./notice"

const NOW = new Date("2026-08-08T12:00:00.000Z")
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS)
const MONTHLY_GRACE = GRACE_DAYS_BY_CYCLE.MONTHLY
const YEARLY_GRACE = GRACE_DAYS_BY_CYCLE.YEARLY

const sub = (over: Partial<Parameters<typeof subscriptionNotice>[0] & object> = {}) => ({
  status: "ACTIVE",
  periodEnd: inDays(30),
  cancelAtPeriodEnd: false,
  // Testlerin varsayılanı aylık (7 gün hoşgörü); yıllık ayrıca sınanıyor.
  billingCycle: "MONTHLY",
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

  it("dönem bitip hoşgörü sürerken 'grace' olur", () => {
    // Dönemin bitmesi erişimin bitmesi DEĞİLDİR. "expired" demek, kartı reddedilen
    // müşteriye kapandığını söyler — oysa modülleri hâlâ açıktır.
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-1) }), NOW)
    expect(notice?.kind).toBe("grace")
    expect(notice?.daysUntilLock).toBe(MONTHLY_GRACE - 1)
  })

  it("hoşgörü dolduktan sonra 'expired' olur", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-MONTHLY_GRACE - 1) }), NOW)
    expect(notice?.kind).toBe("expired")
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

  it("iptal edilmiş abonelik dönem bitince hoşgörüsüz 'expired' olur", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-1), cancelAtPeriodEnd: true }), NOW)
    expect(notice?.kind).toBe("expired")
  })

  it("EXPIRED statüsü tarih ileride olsa bile bitmiş sayılır", () => {
    // reconcile bir kez EXPIRED yazdıysa erişim kapanmıştır; periodEnd'e bakılmaz.
    const notice = subscriptionNotice(sub({ status: "EXPIRED", periodEnd: inDays(5) }), NOW)
    expect(notice?.kind).toBe("expired")
    expect(notice?.daysLeft).toBeLessThanOrEqual(0)
  })

  it("PAST_DUE hoşgörü içindeyse 'grace'", () => {
    expect(subscriptionNotice(sub({ status: "PAST_DUE", periodEnd: inDays(-2) }), NOW)?.kind).toBe(
      "grace",
    )
  })

  it("otomatik yenileme kuruluysa 'bitiyor' şeridi bastırılır", () => {
    // Sorunsuz ödeyen müşteriye her dönem kapatılamayan bir uyarı göstermek gürültüdür.
    const yaklasan = sub({ periodEnd: inDays(2) })
    expect(subscriptionNotice({ ...yaklasan, autoRenewActive: true }, NOW)).toBeNull()
    expect(subscriptionNotice({ ...yaklasan, autoRenewActive: false }, NOW)?.kind).toBe("expiring")
  })

  it("otomatik yenileme kurulu olsa da ÇEKİM BAŞARISIZSA uyarı çıkar", () => {
    // Bastırma yalnız "henüz bitmedi" hâli içindir; çekim reddedilmişse susmak,
    // müşterinin kapanmayı hiç görmemesi demek olurdu.
    const past = { ...sub({ status: "PAST_DUE", periodEnd: inDays(-2) }), autoRenewActive: true }
    expect(subscriptionNotice(past, NOW)?.kind).toBe("grace")
  })
})

describe("locksAt — modüllerin gerçekten kapanacağı an", () => {
  it("ödenmemiş AYLIK abonelikte dönem bitişinden 7 gün sonra", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-1) }), NOW)!
    expect(notice.locksAt.getTime()).toBe(notice.endsAt.getTime() + MONTHLY_GRACE * DAY_MS)
  })

  it("ödenmemiş YILLIK abonelikte 15 gün sonra", () => {
    // Yıllık ödeyen müşteri çoğu zaman muhasebe/onay süreciyle öder; bir hafta yetmez.
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-1), billingCycle: "YEARLY" }), NOW)!
    expect(notice.locksAt.getTime()).toBe(notice.endsAt.getTime() + YEARLY_GRACE * DAY_MS)
  })

  it("periyot bilinmiyorsa UZUN süre varsayılır", () => {
    const notice = subscriptionNotice(sub({ periodEnd: inDays(-1), billingCycle: null }), NOW)!
    expect(notice.locksAt.getTime()).toBe(notice.endsAt.getTime() + YEARLY_GRACE * DAY_MS)
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

describe("isAutoRenewActive", () => {
  const kart = {
    provider: "PAYTR",
    autoRenew: true,
    cancelAtPeriodEnd: false,
    providerSubscriptionId: "tok_123",
  }

  it("dört şart da sağlanırsa doğru", () => {
    expect(isAutoRenewActive(kart, true)).toBe(true)
  })

  it("SAKLI KART YOKSA yanlış — en sık kaçan şart", () => {
    // "Otomatik yenileme açık" yazması tek başına bir şey ifade etmez: token yoksa
    // runRecurring o aboneliği atlar ve dönem sonunda kimse tahsilat yapmaz.
    expect(isAutoRenewActive({ ...kart, providerSubscriptionId: null }, true)).toBe(false)
  })

  it("recurring kapalıysa, iptal işaretliyse ya da sağlayıcı PayTR değilse yanlış", () => {
    expect(isAutoRenewActive(kart, false)).toBe(false)
    expect(isAutoRenewActive({ ...kart, cancelAtPeriodEnd: true }, true)).toBe(false)
    expect(isAutoRenewActive({ ...kart, provider: "NONE" }, true)).toBe(false)
    expect(isAutoRenewActive({ ...kart, autoRenew: false }, true)).toBe(false)
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

  it("hoşgörü dolunca kilitlenir (aylık)", () => {
    const justInside = sub({ status: "PAST_DUE", periodEnd: inDays(-MONTHLY_GRACE + 0.5) })
    const justOutside = sub({ status: "PAST_DUE", periodEnd: inDays(-MONTHLY_GRACE - 0.5) })
    expect(reconcileAction(justInside, NOW)).toBeNull()
    expect(reconcileAction(justOutside, NOW)).toBe("expire")
  })

  it("YILLIK abonelik aylığın kilitlendiği günde HÂLÂ açık", () => {
    // Regresyon kilidi: `billingCycle` select'ten düşerse bu test kırılır ve yıllık
    // müşteriyi 8 gün erken kapı dışında bırakan hata canlıya gitmez.
    const onGun = { status: "PAST_DUE", periodEnd: inDays(-10) }
    expect(reconcileAction(sub({ ...onGun, billingCycle: "MONTHLY" }), NOW)).toBe("expire")
    expect(reconcileAction(sub({ ...onGun, billingCycle: "YEARLY" }), NOW)).toBeNull()
    expect(
      reconcileAction(sub({ status: "PAST_DUE", periodEnd: inDays(-16), billingCycle: "YEARLY" }), NOW),
    ).toBe("expire")
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
    const past = sub({ status: "PAST_DUE", periodEnd: inDays(-MONTHLY_GRACE - 1) })
    expect(reconcileAction(past, NOW)).toBe("expire")
    expect(reconcileAction({ ...past, status: "EXPIRED" }, NOW)).toBeNull()
  })
})

describe("pendingNoticeThreshold", () => {
  const notice = (days: number, over: Record<string, unknown> = {}) =>
    subscriptionNotice(sub({ periodEnd: inDays(days), ...over }), NOW)

  it("ilk kez eşiğe girildiğinde gönderilir", () => {
    for (const days of EMAIL_THRESHOLD_DAYS) {
      expect(pendingNoticeThreshold(notice(days), { lastNoticeThreshold: null })).toBe(days)
    }
  })

  it("aynı eşik iki kez gönderilmez", () => {
    // Cron aynı gün iki kez koşarsa (yeniden deneme, elle çağırma) müşteri iki e-posta almaz.
    expect(pendingNoticeThreshold(notice(3), { lastNoticeThreshold: 3 })).toBeNull()
    // 5 gün kala "7" eşiği zaten gönderilmiş; yeni bir şey yok.
    expect(pendingNoticeThreshold(notice(5), { lastNoticeThreshold: 7 })).toBeNull()
  })

  it("KAÇAN eşik ilk koşuda yakalanır", () => {
    // Cron 3 gün kala koşamadıysa (deploy, sağlayıcı arızası) o eşik kaybolmaz:
    // 2 gün kala hâlâ "3" eşiği borçlu sayılır ve gönderilir. Eski "bugün tam 3 gün mü"
    // yaklaşımı bu uyarıyı sessizce yutuyordu.
    expect(pendingNoticeThreshold(notice(2), { lastNoticeThreshold: 7 })).toBe(3)
  })

  it("eşikler tek yönlü ilerler: expiring → grace → expired", () => {
    expect(pendingNoticeThreshold(notice(1), { lastNoticeThreshold: 3 })).toBe(1)
    expect(pendingNoticeThreshold(notice(-1), { lastNoticeThreshold: 1 })).toBe(GRACE_THRESHOLD)
    expect(pendingNoticeThreshold(notice(-1), { lastNoticeThreshold: GRACE_THRESHOLD })).toBeNull()
    expect(
      pendingNoticeThreshold(notice(-MONTHLY_GRACE - 1), { lastNoticeThreshold: GRACE_THRESHOLD }),
    ).toBe(EXPIRED_THRESHOLD)
    expect(
      pendingNoticeThreshold(notice(-MONTHLY_GRACE - 1), { lastNoticeThreshold: EXPIRED_THRESHOLD }),
    ).toBeNull()
  })

  it("çoktan kapanmış hesaba her gün e-posta atılmaz", () => {
    // Panel şeridi zaten kalıcı; her sabah "aboneliğiniz bitti" göndermek spam olurdu.
    expect(
      pendingNoticeThreshold(notice(-90), { lastNoticeThreshold: EXPIRED_THRESHOLD }),
    ).toBeNull()
  })

  it("uyarı yoksa göndermez", () => {
    expect(pendingNoticeThreshold(null, { lastNoticeThreshold: null })).toBeNull()
  })
})
