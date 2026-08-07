/**
 * Vardiya zamanının tek tanımı — hem API hem takvim bileşeni buradan okur.
 *
 * Vardiya saati veritabanında **gün başından itibaren dakika** olarak durur
 * (`WorkShift.plannedStart/plannedEnd`), `DateTime` olarak değil. Gerekçe şemada
 * uzun uzun yazılı; özeti: bu projede yerel gün ↔ UTC çevrimi bir kez pahalıya
 * patladı (bkz. components/restoran/report-ui.tsx startIso/endIso notu) ve 0–24
 * ızgarasında konum zaten `dakika / 1440` oranıdır.
 *
 * Saf fonksiyonlar: sunucuda da çalışır, tarayıcı API'si gerektirmez.
 */

/** Bir günün dakika sayısı. Izgaranın da genişliği budur. */
export const DAY_MINUTES = 1440

/**
 * Bitişin gidebileceği en uç nokta = ertesi günün sonu.
 *
 * Gece vardiyası 1440'ı AŞAR (22:00–02:00 → 1320–1560). "Bitiş başlangıçtan
 * küçükse ertesi gündür" tahmini kasıtlı olarak yok: o kural, yanlış girilmiş
 * saatle gerçek gece vardiyasını ayırt edilemez hale getirirdi.
 */
export const MAX_MINUTE = 2 * DAY_MINUTES

/** Sürüklerken yakalama adımı (dakika). 15 dk, vardiya planlamasının doğal çözünürlüğü. */
export const SNAP_MINUTES = 15

/** Bir vardiyanın alabileceği en kısa süre — kazara bırakılan sıfır genişlikli bar olmasın. */
export const MIN_SHIFT_MINUTES = 15

/** 540 → "09:00". Ertesi güne taşan dakikada saat başa sarar (1560 → "02:00"). */
export const minuteToHHMM = (m: number): string => {
  const v = ((Math.round(m) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`
}

/** "09:00" → 540. Geçersiz girdide null (çağıran kendi hatasını versin). */
export const hhmmToMinute = (v: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 47 || min > 59) return null
  return h * 60 + min
}

/** Dakikayı SNAP_MINUTES ızgarasına oturtur. */
export const snap = (m: number) => Math.round(m / SNAP_MINUTES) * SNAP_MINUTES

export const clampMinute = (m: number) => Math.min(MAX_MINUTE, Math.max(0, m))

/** Vardiya ertesi güne taşıyor mu (bar 24:00'ı geçiyor mu)? */
export const crossesMidnight = (end: number) => end > DAY_MINUTES

/** Mola düşülmüş çalışma süresi (dakika). Negatife düşmez. */
export const netMinutes = (start: number, end: number, breakMinutes = 0) =>
  Math.max(0, end - start - Math.max(0, breakMinutes))

/** 510 → "8 sa 30 dk" · 480 → "8 sa" · 45 → "45 dk". */
export const durationLabel = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} dk`
  if (rest === 0) return `${h} sa`
  return `${h} sa ${rest} dk`
}

/** Barın üstünde yazan tam etiket: "09:00 – 17:00 (8 sa)". */
export const shiftLabel = (start: number, end: number, breakMinutes = 0) =>
  `${minuteToHHMM(start)} – ${minuteToHHMM(end)} (${durationLabel(netMinutes(start, end, breakMinutes))})`

/** İki aralık çakışıyor mu — aynı personele üst üste vardiya yazılmasın diye. */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd

// ---- Plan ↔ fiilî karşılaştırması --------------------------------------------
//
// Vardiya kaydında hem plan (plannedStart/End) hem fiilî (actualStart/End) durur.
// Aşağıdaki üç ölçü ekranın ve ileride bordronun tek kaynağıdır; her yerde yeniden
// hesaplanırsa aynı vardiya iki ekranda iki türlü "geç kalmış" görünür.

export type ShiftTimes = {
  plannedStart: number
  plannedEnd: number
  actualStart?: number | null
  actualEnd?: number | null
  breakMinutes?: number
}

/**
 * Tolerans (dakika): bu kadarlık sapma geç/erken sayılmaz.
 *
 * Sıfır tolerans, 1 dakikalık farkı da "geç kaldı" diye kırmızıya boyayıp uyarıyı
 * anlamsızlaştırıyordu — damga elle atıldığı için zaten dakika hassasiyeti yok.
 */
export const PUNCTUALITY_TOLERANCE = 5

/** Geç kalınan dakika (tolerans düşülmüş). Damga yoksa null: "bilinmiyor" ≠ "geç değil". */
export const lateMinutes = (s: ShiftTimes): number | null => {
  if (s.actualStart == null) return null
  const diff = s.actualStart - s.plannedStart
  return diff > PUNCTUALITY_TOLERANCE ? diff : 0
}

/** Erken çıkılan dakika. Negatif (fazla çalışma) 0 sayılır — o `overtimeMinutes`. */
export const earlyLeaveMinutes = (s: ShiftTimes): number | null => {
  if (s.actualEnd == null) return null
  const diff = s.plannedEnd - s.actualEnd
  return diff > PUNCTUALITY_TOLERANCE ? diff : 0
}

/** Planlanan bitişten sonra çalışılan dakika. */
export const overtimeMinutes = (s: ShiftTimes): number | null => {
  if (s.actualEnd == null) return null
  const diff = s.actualEnd - s.plannedEnd
  return diff > PUNCTUALITY_TOLERANCE ? diff : 0
}

/**
 * Fiilen çalışılan net süre. İki uç da damgalanmadıysa null.
 *
 * Yalnız giriş damgalanmışsa (vardiya sürüyor) da null döner: "0 dakika çalıştı"
 * demek yanlış olurdu, henüz bitmedi.
 */
export const actualNetMinutes = (s: ShiftTimes): number | null => {
  if (s.actualStart == null || s.actualEnd == null) return null
  return netMinutes(s.actualStart, s.actualEnd, s.breakMinutes ?? 0)
}

/** Ekranda barın altında/üstünde görünecek kısa sapma etiketi; sapma yoksa null. */
export const deviationLabel = (s: ShiftTimes): string | null => {
  const late = lateMinutes(s)
  const early = earlyLeaveMinutes(s)
  const over = overtimeMinutes(s)
  const parts: string[] = []
  if (late) parts.push(`${late} dk geç`)
  if (early) parts.push(`${early} dk erken çıkış`)
  if (over) parts.push(`+${durationLabel(over)} mesai`)
  return parts.length > 0 ? parts.join(" · ") : null
}

// ---- Gün (workDate) ---------------------------------------------------------
//
// `workDate` saatsiz bir gündür. Sunucuya "2026-08-07" olarak gider ve orada
// UTC gece yarısı olarak kurulur (`dayToUtcDate`). Yerel `new Date("2026-08-07")`
// kullanmak TSİ'de bir gün geriye kaymaya yol açardı.

/** Date → "YYYY-MM-DD" (YEREL gün; kullanıcının gördüğü gün budur). */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

export const todayIso = () => isoDay(new Date())

/** "YYYY-MM-DD" + gün farkı → "YYYY-MM-DD". Ay/yıl sınırını doğru geçer. */
export const shiftDayIso = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number)
  return isoDay(new Date(y, (m ?? 1) - 1, (d ?? 1) + delta))
}

/**
 * "YYYY-MM-DD" → UTC gece yarısı Date. `@db.Date` kolonuna yazılacak/karşılaştırılacak
 * değer budur; yerel çevrim kullanılırsa gün kayar.
 */
export const dayToUtcDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

/** `@db.Date` kolonundan okunan Date → "YYYY-MM-DD" (UTC alanlarından; kaymasın). */
export const utcDateToDay = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`

/** Günün içinde bulunduğu haftanın PAZARTESİ'si. Türkiye'de hafta pazartesi başlar. */
export const weekStartIso = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  // getDay(): 0=Pazar. Pazar'ı önceki haftanın 7. günü saymak için 7'ye çeviriyoruz.
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  return shiftDayIso(day, 1 - weekday)
}

/** Pazartesi'den başlayan 7 günlük dizi. */
export const weekDaysIso = (weekStart: string) =>
  Array.from({ length: 7 }, (_, i) => shiftDayIso(weekStart, i))

/** 0=Pazar … 6=Cumartesi — açılış saati tablosunun anahtarı. */
export const weekdayOf = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).getDay()
}

const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"]

/** "7 Ağustos 2026 Cuma" — takvim başlığı. */
export const dayTitle = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return `${date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })} ${GUNLER[date.getDay()]}`
}

export const weekdayLabel = (weekday: number) => GUNLER[weekday] ?? ""
