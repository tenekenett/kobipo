// Abonelik bitiş uyarısı — "ne zaman, kime, ne diyeceğiz" kararının tek yeri.
//
// Neden ayrı bir dosya: aynı karar üç yerde okunuyor (panel şeridi, uyarı e-postası,
// kilitleme eşiği). Üçü ayrı ayrı hesaplarsa biri "3 gün kaldı" derken diğeri e-posta
// göndermez, üçüncüsü erken kilitler. Saf fonksiyon → DB'siz test edilebilir.

import { graceDaysFor } from "@/lib/billing/constants"

export const DAY_MS = 24 * 60 * 60 * 1000

/** Bitişe kaç gün kala uyarmaya başlanır. */
export const NOTICE_WARN_DAYS = 7

/**
 * Uyarının hangi durumu anlattığı.
 *
 * - `expiring` → dönem bitmek üzere, ÖDEME BEKLENİYOR. Erişim sürüyor.
 * - `grace`    → dönem BİTTİ, ödeme alınamadı; erişim hoşgörü süresi boyunca sürüyor.
 *                Kullanıcıya söylenmesi gereken tarih `locksAt`tir, `endsAt` değil.
 * - `expired`  → erişim kapandı (ya da bu koşuda kapanacak).
 */
export type SubscriptionNoticeKind = "expiring" | "grace" | "expired"

export type SubscriptionNotice = {
  kind: SubscriptionNoticeKind
  /** Ödenmiş dönemin bittiği (ya da biteceği) an. */
  endsAt: Date
  /** Dönem bitişine kalan tam gün; geçmişse 0 veya negatif. */
  daysLeft: number
  /** Dönem sonunda yenilenmeyeceği KESİN mi (iptal edilmiş)? Metni sertleştirir. */
  cancelling: boolean
  /**
   * MODÜLLERİN GERÇEKTEN KAPANACAĞI an. `endsAt` ile aynı değildir: ödeme alınamayan
   * abonelikte araya hoşgörü süresi girer (periyoda göre 7 ya da 15 gün). Kullanıcıya
   * "ne zaman kapanacak" denirken bu tarih söylenmeli, dönem bitişi değil.
   */
  locksAt: Date
  /** Kilide kalan tam gün. `grace` şeridindeki geri sayım budur. */
  daysUntilLock: number
}

export type NoticeSubscription = {
  status: string
  periodEnd: Date | null
  /** MONTHLY | YEARLY — hoşgörü süresi buna göre değişir. Yoksa uzun süre varsayılır. */
  billingCycle?: string | null
  cancelAtPeriodEnd?: boolean
  /**
   * Saklı kartla OTOMATİK yenilenecek mi? Doluysa "bitiyor" uyarısı BASTIRILIR:
   * her ay kapatılamayan bir şerit görmek, sorunsuz ödeyen müşteri için gürültüdür.
   * Çekim başarısız olursa abonelik `PAST_DUE`'ya düşer ve `grace` şeridi devreye girer.
   *
   * Çağıran hesaplar (env dahil) — bkz. `isAutoRenewActive`.
   */
  autoRenewActive?: boolean
}

/**
 * Abonelik gerçekten kendi kendine yenilenecek durumda mı?
 *
 * Dört şartın DÖRDÜ de gerekli; biri eksikse dönem sonunda kimse tahsilat yapmaz ve
 * müşteri uyarılmalıdır. En sık kaçan şart `providerSubscriptionId`: saklı kart token'ı
 * yoksa `runRecurring` o aboneliği atlar, yani "otomatik yenileme açık" yazması tek
 * başına bir şey ifade etmez.
 */
export function isAutoRenewActive(
  sub: {
    provider?: string | null
    autoRenew?: boolean | null
    cancelAtPeriodEnd?: boolean | null
    providerSubscriptionId?: string | null
  },
  recurringEnabled: boolean,
): boolean {
  return (
    recurringEnabled &&
    sub.provider === "PAYTR" &&
    Boolean(sub.autoRenew) &&
    !sub.cancelAtPeriodEnd &&
    Boolean(sub.providerSubscriptionId)
  )
}

/** Tam gün cinsinden fark (yukarı yuvarlar): "kaç gün kaldı". */
function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS)
}

/**
 * Bir hesabın aboneliği için gösterilecek uyarı — yoksa `null`.
 *
 * - `ACTIVE`: dönem sonuna `warnDays` veya daha az kaldıysa "expiring" (otomatik yenileme
 *   gerçekten kuruluysa bastırılır), geçtiyse "grace" — reconcile henüz koşmamış olabilir,
 *   kullanıcı beklemesin.
 * - `PAST_DUE`: hoşgörü sürüyorsa "grace", dolduysa "expired".
 * - `CANCELLED`: hoşgörü YOK; kalan süre "expiring", sonrası "expired".
 * - `EXPIRED`: her hâlde "expired".
 * - `TRIAL` ve aboneliksiz hesap: `null`. Deneme modül vermiyor (bkz.
 *   `resolveGrantedModules`), uyarılacak bir erişim yok — o hesap zaten `LockedAccount` görür.
 */
export function subscriptionNotice(
  sub: NoticeSubscription | null | undefined,
  now: Date = new Date(),
  warnDays: number = NOTICE_WARN_DAYS,
): SubscriptionNotice | null {
  if (!sub || !sub.periodEnd) return null
  if (sub.status === "TRIAL") return null

  const endsAt = sub.periodEnd
  const daysLeft = daysBetween(now, endsAt)
  const cancelling = sub.status === "CANCELLED" || Boolean(sub.cancelAtPeriodEnd)

  // İptal edilmiş abonelikte hoşgörü yok: kullanıcı dönem sonunda bitmesini kendisi
  // istedi. EXPIRED zaten kapanmış demektir. Kalan hâllerde araya hoşgörü girer.
  const graceDays = graceDaysFor(sub.billingCycle)
  const locksAt =
    cancelling || sub.status === "EXPIRED"
      ? endsAt
      : new Date(endsAt.getTime() + graceDays * DAY_MS)
  const daysUntilLock = daysBetween(now, locksAt)

  const build = (kind: SubscriptionNoticeKind): SubscriptionNotice => ({
    kind,
    endsAt,
    daysLeft,
    cancelling,
    locksAt,
    daysUntilLock,
  })

  if (sub.status === "EXPIRED") {
    return { ...build("expired"), daysLeft: Math.min(daysLeft, 0), cancelling: true }
  }

  if (sub.status === "ACTIVE" || sub.status === "PAST_DUE" || sub.status === "CANCELLED") {
    // Dönem henüz bitmedi.
    if (daysLeft > 0) {
      if (daysLeft > warnDays) return null
      // Kart saklı ve otomatik yenileme gerçekten kuruluysa uyarma: tahsilat kendiliğinden
      // olacak. İptal işaretliyse `autoRenewActive` zaten false döner.
      if (sub.autoRenewActive) return null
      return build("expiring")
    }

    // Dönem bitti. İptal edilmişse hoşgörü yok → doğrudan kapalı sayılır.
    if (cancelling) return build("expired")
    // Hoşgörü sürüyor mu? (reconcile henüz PAST_DUE yazmamış olabilir; karar tarihe bakar)
    return daysUntilLock > 0 ? build("grace") : build("expired")
  }

  return null
}

/**
 * `reconcile` bir abonelik satırında ne yapmalı?
 *
 * - `"past_due"` → dönem bitti, hoşgörü başlasın. Statü `PAST_DUE` olur, **modüllere
 *   DOKUNULMAZ** (erişim sürer, bkz. `isInGracePeriod`).
 * - `"expire"` → erişim bitti. Statü `EXPIRED` olur ve yetkiler yeniden hesaplanır
 *   (pratikte kilit).
 * - `null` → yapacak bir şey yok.
 *
 * Saf tutuluyor çünkü hatanın yaşayacağı yer burası: bir gün erken kilitlemek ödeme
 * yapan müşteriyi kapı dışında bırakır, hiç kilitlememek ise geliri sızdırır.
 */
export function reconcileAction(
  sub: NoticeSubscription & { trialEndsAt?: Date | null },
  now: Date = new Date(),
  graceDays: number = graceDaysFor(sub.billingCycle),
): "expire" | "past_due" | null {
  // Deneme: modül vermiyor, hoşgörüsü de yok — süresi dolunca kapanır. (Süper-admin'in
  // elle açtığı demo hesap da bu yolla kapanır, bkz. lib/billing/admin.ts reset("trial").)
  if (sub.status === "TRIAL") {
    return sub.trialEndsAt && sub.trialEndsAt.getTime() <= now.getTime() ? "expire" : null
  }

  if (!sub.periodEnd) return null
  const ended = sub.periodEnd.getTime() <= now.getTime()

  if (sub.status === "ACTIVE") {
    if (!ended) return null
    // Kullanıcı dönem sonunda iptali kendisi istediyse hoşgörü uygulanmaz.
    return sub.cancelAtPeriodEnd ? "expire" : "past_due"
  }

  if (sub.status === "PAST_DUE") {
    const locksAt = sub.periodEnd.getTime() + graceDays * DAY_MS
    return locksAt <= now.getTime() ? "expire" : null
  }

  // CANCELLED: dönem bitince kapanır, hoşgörü yok. EXPIRED: zaten kapalı.
  if (sub.status === "CANCELLED") return ended ? "expire" : null
  return null
}

/**
 * Uyarı e-postasının gönderileceği eşik günler (kalan gün sayısı), ACİLİYETE göre azalan.
 */
export const EMAIL_THRESHOLD_DAYS = [7, 3, 1]

/** Hoşgörü başlangıcının eşik değeri — dönem bitti, ödeme bekleniyor. */
export const GRACE_THRESHOLD = 0
/** Kilit anının eşik değeri — erişim kapandı. */
export const EXPIRED_THRESHOLD = -1

export type NoticeState = {
  /** En son hangi eşik için e-posta gönderildi? Hiç gönderilmediyse null. */
  lastNoticeThreshold: number | null
}

/**
 * Bu abonelik için ŞU AN gönderilmesi gereken eşik — gönderilecek bir şey yoksa `null`.
 *
 * Neden eşik DURUMU tutuluyor da "bugün tam 3 gün kaldı mı" diye bakılmıyor: o yaklaşım
 * cron'un günde TAM BİR KEZ koştuğunu varsayar ve iki yönden de kırılır —
 *
 *   - cron iki kez koşarsa (yeniden deneme, elle çağırma) aynı e-posta ikilenir;
 *   - cron bir gün kaçarsa (deploy, sağlayıcı arızası) o eşik SESSİZCE atlanır ve bir
 *     daha hiç denenmez; müşteri "1 gün kaldı" uyarısını hiç almaz.
 *
 * Bunun yerine "hangi eşiklere ULAŞILDI" hesaplanır, en acili seçilir ve daha önce
 * gönderilenden daha acil olması şartı aranır. Eşikler tek yönlü ilerler (7 → 3 → 1 →
 * 0 → -1), böylece geri sayım bir gün kaçsa bile atlanan eşik ilk koşuda yakalanır.
 */
export function pendingNoticeThreshold(
  notice: SubscriptionNotice | null,
  state: NoticeState,
): number | null {
  if (!notice) return null

  const current =
    notice.kind === "expired"
      ? EXPIRED_THRESHOLD
      : notice.kind === "grace"
        ? GRACE_THRESHOLD
        : // "expiring": ulaşılmış eşiklerin EN ACİLİ (en küçüğü).
          EMAIL_THRESHOLD_DAYS.filter((t) => notice.daysLeft <= t).sort((a, b) => a - b)[0]

  if (current == null) return null

  const last = state.lastNoticeThreshold
  // Daha önce hiç gönderilmediyse ya da bu eşik öncekinden DAHA ACİLSE gönder.
  return last == null || last > current ? current : null
}
