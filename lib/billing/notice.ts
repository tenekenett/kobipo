// Abonelik bitiş uyarısı — "ne zaman, kime, ne diyeceğiz" kararının tek yeri.
//
// Neden ayrı bir dosya: aynı karar üç yerde okunuyor (panel banner'ı, uyarı e-postası,
// ileride kilitleme eşiği). Üçü ayrı ayrı hesaplarsa biri "3 gün kaldı" derken diğeri
// e-posta göndermez. Saf fonksiyon → DB'siz test edilebilir.
//
// DİKKAT — bugün hiçbir abonelik OTOMATİK YENİLENMİYOR: `/api/billing/recurring/run`
// iskele hâlinde (gerçek PayTR çekimi yok). Yani `autoRenew` açık olsa bile dönem
// sonunda erişim biter; metinler bu gerçeğe göre yazılmıştır. Recurring canlıya
// alındığında buradaki dil de gözden geçirilmeli.

import { GRACE_PERIOD_DAYS } from "@/lib/billing/constants"

export const DAY_MS = 24 * 60 * 60 * 1000

/** Bitişe kaç gün kala uyarmaya başlanır. */
export const NOTICE_WARN_DAYS = 7

export type SubscriptionNoticeKind = "expiring" | "expired"

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
   * abonelikte araya `GRACE_PERIOD_DAYS` girer. Kullanıcıya "ne zaman kapanacak"
   * denirken bu tarih söylenmeli, dönem bitişi değil.
   */
  locksAt: Date
}

export type NoticeSubscription = {
  status: string
  periodEnd: Date | null
  cancelAtPeriodEnd?: boolean
}

/**
 * Bir hesabın aboneliği için gösterilecek uyarı — yoksa `null`.
 *
 * - `ACTIVE` / `PAST_DUE`: dönem sonuna `warnDays` veya daha az kaldıysa "expiring",
 *   geçtiyse "expired".
 * - `CANCELLED` / `EXPIRED`: dönem sonu ne olursa olsun uyarılır (iptal edilmiş bir
 *   abonelikte kalan süre de bilgidir).
 * - `TRIAL` ve aboneliksiz hesap: `null`. Deneme artık modül vermiyor
 *   (bkz. resolveGrantedModules), uyarılacak bir erişim yok — o hesap zaten
 *   `LockedAccount` görüyor.
 */
export function subscriptionNotice(
  sub: NoticeSubscription | null | undefined,
  now: Date = new Date(),
  warnDays: number = NOTICE_WARN_DAYS
): SubscriptionNotice | null {
  if (!sub || !sub.periodEnd) return null
  if (sub.status === "TRIAL") return null

  const endsAt = sub.periodEnd
  const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)
  const cancelling = sub.status === "CANCELLED" || Boolean(sub.cancelAtPeriodEnd)

  // İptal edilmiş abonelikte hoşgörü yok: kullanıcı dönem sonunda bitmesini kendisi
  // istedi. EXPIRED zaten kapanmış demektir. Kalan hâllerde araya hoşgörü girer.
  const locksAt =
    cancelling || sub.status === "EXPIRED"
      ? endsAt
      : new Date(endsAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS)

  if (sub.status === "EXPIRED") {
    return { kind: "expired", endsAt, daysLeft: Math.min(daysLeft, 0), cancelling: true, locksAt }
  }

  if (sub.status === "ACTIVE" || sub.status === "PAST_DUE" || sub.status === "CANCELLED") {
    if (daysLeft <= 0) return { kind: "expired", endsAt, daysLeft, cancelling, locksAt }
    if (daysLeft <= warnDays) return { kind: "expiring", endsAt, daysLeft, cancelling, locksAt }
    return null
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
  graceDays: number = GRACE_PERIOD_DAYS
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
 * Uyarı e-postasının gönderileceği "eşik" günler. Bildirim işi günde BİR kez koştuğu
 * için durum saklamaya gerek kalmaz: her eşik yalnız o gün yakalanır.
 * (Aynı gün iki kez koşturulursa e-posta ikilenir — uç cron korumalı, kabul edilebilir.)
 */
export const EMAIL_THRESHOLD_DAYS = [7, 3, 1]

/**
 * Bugün bu abonelik için e-posta atılmalı mı?
 *
 * Bitmiş abonelikte yalnız bitiş günü (ve cron bir gün kaçarsa ertesi gün) gönderilir;
 * "her gün hatırlat" davranışı istenmiyor — panel banner'ı zaten kalıcı.
 */
export function shouldEmailToday(notice: SubscriptionNotice | null): boolean {
  if (!notice) return false
  if (notice.kind === "expiring") return EMAIL_THRESHOLD_DAYS.includes(notice.daysLeft)
  return notice.daysLeft === 0 || notice.daysLeft === -1
}
