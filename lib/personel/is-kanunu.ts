/**
 * 4857 sayılı İş Kanunu'nun vardiya planlamasında karşılığı olan sınırlar.
 *
 * Bunlar HATA DEĞİL UYARIDIR ve hiçbir uç bir vardiyayı bu yüzden reddetmez:
 * denkleştirme (m.63), işçinin yazılı onayıyla fazla çalışma (m.41) ve sektörel
 * istisnalar bu sınırların yasal olarak aşılabildiği durumlardır. Yazılımın
 * söyleyebileceği şey "olmaz" değil, "bu hafta 45 saati aştı"dır; kararı ve
 * sorumluluğu işveren verir. Bu yüzden hesap tamamen İSTEMCİ tarafındadır —
 * zaten çizilmiş haftanın verisinden türer, ekstra sorgu gerektirmez.
 *
 * Ölçüler NET süredir (mola düşülmüş): ara dinlenmeler çalışma süresinden
 * sayılmaz (m.68), dolayısıyla 45 saatin içinde de yer almazlar.
 */

import {
  DAY_MINUTES,
  durationLabel,
  minuteToHHMM,
  netMinutes,
  shortDayLabel,
} from "@/lib/personel/vardiya"

/** Haftalık azami çalışma süresi (m.63). Denkleştirmeyle 2 ayda ortalanabilir. */
export const WEEKLY_MAX_MINUTES = 45 * 60

/** Günlük azami çalışma süresi (m.63) — denkleştirmede bile aşılamaz. */
export const DAILY_MAX_MINUTES = 11 * 60

/** İki vardiya arasında bırakılması gereken en az dinlenme (m.69, gece postaları). */
export const MIN_REST_MINUTES = 11 * 60

export type LaborWarningCode = "WEEKLY" | "DAILY" | "REST" | "NO_DAY_OFF"

export type LaborWarning = { code: LaborWarningCode; message: string }

export type LaborShift = {
  /** "YYYY-MM-DD" */
  workDate: string
  plannedStart: number
  plannedEnd: number
  breakMinutes: number
}

/**
 * TEK personelin TEK haftasındaki plan uyarıları.
 *
 * `weekDays` haftanın sıralı günleridir (pazartesi → pazar); gün sırası hem
 * "kaç gün çalıştı" hesabında hem de vardiyaları mutlak zaman eksenine dizmekte
 * kullanılır. Ekseni gün indeksinden kurmak, gece vardiyasının 1440'ı aşan
 * bitişini (22:00–02:00 → 1320–1560) doğal olarak ertesi güne taşır; bu yüzden
 * dinlenme süresi tarih aritmetiği olmadan çıkar.
 *
 * Hafta dışındaki vardiyalar yok sayılır — çağıran ekran zaten o haftayı çizer.
 */
export function laborWarnings(shifts: LaborShift[], weekDays: string[]): LaborWarning[] {
  const dayIndex = new Map(weekDays.map((d, i) => [d, i]))
  const own = shifts.filter((s) => dayIndex.has(s.workDate))
  if (own.length === 0) return []

  const warnings: LaborWarning[] = []
  const net = (s: LaborShift) => netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes)

  const weekly = own.reduce((sum, s) => sum + net(s), 0)
  if (weekly > WEEKLY_MAX_MINUTES) {
    warnings.push({
      code: "WEEKLY",
      message: `Haftalık ${durationLabel(weekly)} — yasal 45 saati ${durationLabel(
        weekly - WEEKLY_MAX_MINUTES,
      )} aşıyor`,
    })
  }

  for (const day of weekDays) {
    // Aynı güne iki vardiya yazılabilir (sabah + akşam); günlük sınır ikisinin
    // TOPLAMINA bakar, tek tek barlara değil.
    const total = own.filter((s) => s.workDate === day).reduce((sum, s) => sum + net(s), 0)
    if (total > DAILY_MAX_MINUTES) {
      warnings.push({
        code: "DAILY",
        message: `${shortDayLabel(day)}: ${durationLabel(total)} — günlük 11 saat sınırı aşılıyor`,
      })
    }
  }

  const ordered = own
    .map((s) => ({
      day: s.workDate,
      startAbs: (dayIndex.get(s.workDate) ?? 0) * DAY_MINUTES + s.plannedStart,
      endAbs: (dayIndex.get(s.workDate) ?? 0) * DAY_MINUTES + s.plannedEnd,
      end: s.plannedEnd,
      start: s.plannedStart,
    }))
    .sort((a, b) => a.startAbs - b.startAbs)

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const cur = ordered[i]
    // AYNI GÜNE yazılmış iki vardiya arasındaki boşluk dinlenme süresi değil ara
    // dinlenmedir (m.68) ve 11 saat şartına tabi değildir: kafede öğlen + akşam
    // servisi diye bölünmüş vardiya olağandır. O günün yükü zaten günlük 11 saat
    // kuralıyla denetleniyor. Ölçüt `workDate`tir; gece vardiyası ertesi güne
    // taşsa da kendi gününe yazılıdır, sonraki günün vardiyasıyla karşılaştırılır.
    if (prev.day === cur.day) continue
    const gap = cur.startAbs - prev.endAbs
    if (gap < MIN_REST_MINUTES) {
      warnings.push({
        code: "REST",
        message: `${shortDayLabel(prev.day)} ${minuteToHHMM(prev.end)} → ${shortDayLabel(cur.day)} ${minuteToHHMM(
          cur.start,
        )} arası ${durationLabel(Math.max(0, gap))} dinlenme (en az 11 saat)`,
      })
    }
  }

  // Hafta tatili: kesintisiz en az 24 saat (m.46). Ölçüsü "hiç vardiya yazılmamış
  // bir gün" — yarım günlük vardiyanın kalanı hafta tatili sayılmaz.
  const workedDays = new Set(own.map((s) => s.workDate)).size
  if (workedDays >= weekDays.length) {
    warnings.push({ code: "NO_DAY_OFF", message: "Haftanın yedi günü de dolu — hafta tatili yok" })
  }

  return warnings
}
