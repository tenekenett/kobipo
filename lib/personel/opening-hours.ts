/**
 * İşletmenin haftalık açılış saati — firma başına tek, `Company.openingHours` (jsonb).
 *
 * Vardiya takviminde iki iş yapar: en üstteki "Açılış saati" satırını çizer ve
 * personel satırlarının arkasına gölge bant koyar. "İşletme açık ama o saatte
 * kimse yok" boşluğu ancak bu bantla görünür hale gelir — takvimin asıl kazancı da
 * bu, çünkü boş bir satır kendi başına bir şey söylemiyor.
 *
 * Saatler `lib/personel/vardiya.ts` ile aynı birimde: gün başından itibaren DAKİKA.
 * Kapanış 1440'ı aşabilir (gece 02:00'de kapanan bar → 1560).
 */

import { DAY_MINUTES, MAX_MINUTE } from "@/lib/personel/vardiya"

export type OpeningDay = {
  /** Kapalıysa saatler yok sayılır (değerleri korunur ki tekrar açılınca geri gelsin). */
  closed: boolean
  start: number
  end: number
}

/** 0=Pazar … 6=Cumartesi — dizinin indisi haftanın günüdür (Date.getDay() ile aynı). */
export type OpeningHours = OpeningDay[]

const DEFAULT_DAY: OpeningDay = { closed: false, start: 9 * 60, end: 18 * 60 }

/** Hiç tanımlanmamış firmanın başlangıç tablosu: her gün 09:00–18:00, Pazar kapalı. */
export const DEFAULT_OPENING_HOURS: OpeningHours = Array.from({ length: 7 }, (_, weekday) => ({
  ...DEFAULT_DAY,
  closed: weekday === 0,
}))

const clean = (v: unknown, fallback: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_MINUTE, Math.max(0, n))
}

/**
 * Gelen JSON'u güvenli tabloya çevirir. NULL/bozuk veri `null` döner — çağıran
 * "tanımsız" ile "tanımlı ama kapalı"yı ayırabilsin diye varsayılana DÜŞMEZ:
 * tanımsız firmada bant hiç çizilmemeli, yoksa kullanıcı hiç girmediği bir
 * çalışma saatini kendi verisi sanır.
 */
export function normalizeOpeningHours(value: unknown): OpeningHours | null {
  if (!Array.isArray(value) || value.length !== 7) return null
  return value.map((raw, weekday) => {
    const d = (raw ?? {}) as Partial<OpeningDay>
    const start = clean(d.start, DEFAULT_OPENING_HOURS[weekday].start)
    const end = clean(d.end, DEFAULT_OPENING_HOURS[weekday].end)
    return {
      closed: Boolean(d.closed) || end <= start,
      start,
      end: Math.min(MAX_MINUTE, Math.max(start, end)),
    }
  })
}

/** O günün açılış aralığı; kapalı/tanımsızsa null. */
export function openingOfDay(hours: OpeningHours | null, weekday: number): OpeningDay | null {
  const d = hours?.[weekday]
  if (!d || d.closed) return null
  return d
}

/**
 * Izgaranın kaç saati göstereceği: açılış saatini kapsayan en dar 0–24 penceresi.
 * Gece 02:00'ye çalışan işletmede pencere 24'ü aşar, sabahçı fırında dar kalır.
 * Vardiyalar da hesaba katılır — açılış dışına yazılmış vardiya kırpılmasın.
 */
export function gridWindow(
  hours: OpeningHours | null,
  weekday: number,
  shifts: { plannedStart: number; plannedEnd: number }[],
): { from: number; to: number } {
  const open = openingOfDay(hours, weekday)
  let from = open ? open.start : 8 * 60
  let to = open ? open.end : 20 * 60
  for (const s of shifts) {
    from = Math.min(from, s.plannedStart)
    to = Math.max(to, s.plannedEnd)
  }
  // Saat başlarına yuvarla ve en az 8 saatlik bir pencere bırak: tek bir kısa
  // vardiya varken ızgara iki sütuna düşerse sürükleyecek yer kalmıyor.
  from = Math.max(0, Math.floor(from / 60) * 60)
  to = Math.min(MAX_MINUTE, Math.ceil(to / 60) * 60)
  if (to - from < 8 * 60) to = Math.min(MAX_MINUTE, from + 8 * 60)
  if (to <= from) return { from: 0, to: DAY_MINUTES }
  return { from, to }
}
