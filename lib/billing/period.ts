// Abonelik DÖNEM MATEMATİĞİ — saf, DB'siz, tek kural.
//
// Neden ayrı dosya: "dönem ne zaman biter" sorusu bugün üç yerden soruluyor (satın alma,
// yinelenen çekim, sistem-admin süre verme). Her biri kendi `setMonth`'unu yazarsa aynı
// soruya üç cevap çıkar — bu alt sistemde daha önce tam olarak bu oldu
// (docs/paket-abonelik/ABONELIK-TAMAMLAMA.md → Faz 6, "erken yenileyen gün kaybediyor").

import type { BillingCycle } from "@/lib/billing/constants"

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

/**
 * Ay ekler ve **ayın son gününe kırpar**.
 *
 * JS'in ham `setMonth`'u taşırıyor: 31 Ocak + 1 ay = 3 Mart. Bu, ayın sonunda ödeyen
 * müşteriye sessizce fazladan 2-3 gün vermek (ya da elle süre verirken sözü verilenden
 * fazlasını yazmak) demek. Kırpma ile 31 Ocak + 1 ay = 28/29 Şubat olur — takvim ayı
 * neyse o.
 */
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date)
  const day = d.getDate()
  // Önce ayın 1'ine çek: aksi halde `setMonth` hedef ayı hesaplarken günü taşırır.
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())))
  return d
}

/** Yıl ekler; 29 Şubat artık olmayan yılda 28 Şubat'a kırpılır. */
export function addYears(date: Date, n: number): Date {
  return addMonths(date, n * 12)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/**
 * Periyoda göre dönem bitiş tarihi (başlangıçtan +1 ay / +1 yıl).
 *
 * Burada durur çünkü SUNUCU DIŞINDAN da soruluyor: abonelik ekranı "ödersem dönemim ne
 * zamana uzar" cümlesini basarken aynı cevabı vermek zorunda. `entitlements.ts` prisma
 * çekiyor, istemciye alınamaz; kural orada kalsaydı ekran kendi takvimini yazar ve
 * müşteriye sunucudan farklı bir tarih gösterirdi.
 */
export function periodEndFor(cycle: BillingCycle, start = new Date()): Date {
  return cycle === "YEARLY" ? addYears(start, 1) : addMonths(start, 1)
}

// ---------------------------------------------------------------------------
// Elle süre verme penceresi (sistem-admin)
// ---------------------------------------------------------------------------

/** Süre üç şekilden BİRİYLE verilir; ikisini birden vermek belirsizdir. */
export type GrantDuration = {
  days?: number | null
  months?: number | null
  untilDate?: Date | null
}

/**
 * `extend` → mevcut dönemin ÜSTÜNE ekle. `set` → bugünden başlayan yeni dönem yaz.
 *
 * Fark yalnız dönemi HENÜZ BİTMEMİŞ hesapta görünür: `extend` kalan günleri korur,
 * `set` onları siler. Süresi çoktan dolmuş hesapta ikisi de bugünden başlar.
 */
export type GrantMode = "extend" | "set"

export type GrantWindowInput = {
  mode: GrantMode
  duration: GrantDuration
  now: Date
  /** Aboneliğin mevcut dönem başlangıcı (yoksa null). */
  currentStart: Date | null
  /** Mevcut erişim bitişi: ücretli dönemde `periodEnd`, denemede `trialEndsAt`. */
  currentEnd: Date | null
}

export type GrantWindow = {
  periodStart: Date
  periodEnd: Date
  /** Sürenin neyin üstüne eklendiği — olay özetinde açıklanır. */
  basedOn: "period" | "now" | "date"
  /**
   * GERÇEKTEN eklenen gün sayısı: yeni bitiş eksi sürenin bindirildiği taban.
   *
   * Taban `basedOn`a göre değişir — "period"ta mevcut dönem sonu, aksi halde bugün.
   * Bu ayrım şart: dönemi 2027'de biten bir aboneliği "1 ay uzat"tığınızda eklenen
   * 30 gündür, bugünden bitişe kalan ise 275. İkisini tek alanda tutmak, yöneticiye
   * "1 ay" yazdıktan sonra "275 gün verildi" demek anlamına geliyordu.
   */
  addedDays: number
  /** Bugünden yeni bitişe kalan gün — "ne kadar yolu var" göstergesi. */
  totalDaysFromNow: number
}

export type GrantWindowResult =
  | { ok: true; window: GrantWindow }
  | { ok: false; code: string; message: string }

/** Elle verilebilecek en uzun süre — yanlış girişe karşı emniyet (10 yıl). */
export const MAX_GRANT_DAYS = 3650
export const MAX_GRANT_MONTHS = 120

/**
 * Elle verilen sürenin dönem penceresini çözer. Saf: tarih dışında hiçbir şey okumaz.
 *
 * Kurallar:
 * - `days` / `months` / `untilDate`ten **tam olarak biri** verilmeli.
 * - `untilDate` verilirse `mode` süreyi ETKİLEMEZ (tarih zaten mutlak); yalnız dönem
 *   başlangıcının korunup korunmayacağını belirler.
 * - `extend`, dönem gelecekteyse ONDAN uzatır; geçmişte kalmışsa bugünden başlar —
 *   geçmişten uzatmak "1 ay verdim" denen hesaba fiilen birkaç gün vermek olurdu.
 * - Sonuç daima gelecekte olmalı; geçmişe biten bir dönem "süre vermek" değildir.
 */
export function resolveGrantWindow(input: GrantWindowInput): GrantWindowResult {
  const { mode, duration, now, currentStart, currentEnd } = input

  const given = [duration.days, duration.months, duration.untilDate].filter(
    (v) => v != null,
  ).length
  if (given === 0) {
    return { ok: false, code: "NO_DURATION", message: "Süre verilmedi (gün, ay veya tarih)" }
  }
  if (given > 1) {
    return {
      ok: false,
      code: "AMBIGUOUS_DURATION",
      message: "Gün, ay ve tarihten yalnız biri verilebilir",
    }
  }

  // `extend` için taban: dönem gelecekteyse o, değilse bugün.
  const future = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : null
  const base = mode === "extend" && future ? future : now
  const basedOn: GrantWindow["basedOn"] = mode === "extend" && future ? "period" : "now"

  // Başlangıç: `set` her zaman bugünden yazar; `extend` mevcut başlangıcı korur
  // (dönem uzuyor, yeniden başlamıyor).
  const periodStart = mode === "set" ? now : (currentStart ?? now)

  let periodEnd: Date
  let resolvedBase: GrantWindow["basedOn"] = basedOn

  if (duration.untilDate != null) {
    periodEnd = new Date(duration.untilDate)
    resolvedBase = "date"
    if (Number.isNaN(periodEnd.getTime())) {
      return { ok: false, code: "INVALID_DATE", message: "Geçersiz tarih" }
    }
  } else if (duration.days != null) {
    const days = duration.days
    if (!Number.isInteger(days) || days < 1 || days > MAX_GRANT_DAYS) {
      return {
        ok: false,
        code: "INVALID_DAYS",
        message: `Gün 1 ile ${MAX_GRANT_DAYS} arasında bir tam sayı olmalı`,
      }
    }
    periodEnd = addDays(base, days)
  } else {
    const months = duration.months as number
    if (!Number.isInteger(months) || months < 1 || months > MAX_GRANT_MONTHS) {
      return {
        ok: false,
        code: "INVALID_MONTHS",
        message: `Ay 1 ile ${MAX_GRANT_MONTHS} arasında bir tam sayı olmalı`,
      }
    }
    periodEnd = addMonths(base, months)
  }

  if (periodEnd.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: "PAST_END",
      message: "Verilen süre bugünden ileride olmalı",
    }
  }

  // Eklenen gün, sürenin bindirildiği TABANDAN sayılır (`base`), bugünden değil:
  // gelecekte biten bir döneme 1 ay eklemek 30 gündür, 275 değil.
  const dayCount = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000)

  return {
    ok: true,
    window: {
      periodStart,
      periodEnd,
      basedOn: resolvedBase,
      addedDays: dayCount(base, periodEnd),
      totalDaysFromNow: dayCount(now, periodEnd),
    },
  }
}
