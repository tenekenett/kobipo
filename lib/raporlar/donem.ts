/**
 * Finansal panonun DÖNEM hazır seçenekleri — SAF modül.
 *
 * Ayrı dosya çünkü üç yer okuyor: pano hesabı (`finansal-ozet.ts`, Prisma'lı),
 * dönem seçici bileşeni (istemci) ve alt raporlara taşınan link. Kopyalansaydı
 * seçicide "Bu Çeyrek" yazarken hesabın başka bir aralık okuması işten değildi.
 *
 * Gün değerleri `toDateInput` ile yazılır (yerel gün): `toISOString()` UTC'ye
 * kaydığı için 1 Ocak varsayılanı kutuda "31 Aralık" görünüyordu.
 */

import { toDateInput } from "@/lib/format"

export type PeriodPresetKey = "bu-ay" | "gecen-ay" | "bu-ceyrek" | "bu-yil" | "gecen-yil"

export type PeriodPreset = { key: PeriodPresetKey; label: string }

/** Seçicide BU SIRAYLA görünür. */
export const PERIOD_PRESETS: PeriodPreset[] = [
  { key: "bu-ay", label: "Bu Ay" },
  { key: "gecen-ay", label: "Geçen Ay" },
  { key: "bu-ceyrek", label: "Bu Çeyrek" },
  { key: "bu-yil", label: "Bu Yıl" },
  { key: "gecen-yil", label: "Geçen Yıl" },
]

export const DEFAULT_PERIOD: PeriodPresetKey = "bu-yil"

export type ResolvedPeriod = {
  startDate: string
  endDate: string
  label: string
  /**
   * KARŞILAŞTIRMA dönemi: aynı uzunlukta, hemen öncesi. Ekrandaki "% değişim"
   * bundan çıkar. Takvim dönemlerinde (ay/çeyrek/yıl) bir önceki takvim
   * dönemidir — "geçen ay 30 gün, bu ay 31" diye kaydırmak, şubatı ocakla
   * kıyaslarken üç günü ikinci kez saydırırdı.
   */
  previous: { startDate: string; endDate: string; label: string }
}

function day(year: number, monthIndex: number, date: number): string {
  return toDateInput(new Date(year, monthIndex, date))
}

/** Ayın son gününü `0` ile bulur: `new Date(y, m + 1, 0)`. */
function endOfMonth(year: number, monthIndex: number): string {
  return toDateInput(new Date(year, monthIndex + 1, 0))
}

export function isPeriodPreset(value: unknown): value is PeriodPresetKey {
  return PERIOD_PRESETS.some((preset) => preset.key === value)
}

/**
 * Hazır seçeneği tarihlere çevirir. Bilinmeyen/boş değer varsayılana düşer —
 * adres çubuğuna elle yazılan çöp değer panoyu patlatmasın.
 */
export function resolvePeriod(
  key: string | null | undefined,
  today: Date = new Date()
): ResolvedPeriod {
  const preset = isPeriodPreset(key) ? key : DEFAULT_PERIOD
  const y = today.getFullYear()
  const m = today.getMonth()

  switch (preset) {
    case "gecen-ay": {
      const prev = new Date(y, m - 1, 1)
      const before = new Date(y, m - 2, 1)
      return {
        startDate: day(prev.getFullYear(), prev.getMonth(), 1),
        endDate: endOfMonth(prev.getFullYear(), prev.getMonth()),
        label: "Geçen Ay",
        previous: {
          startDate: day(before.getFullYear(), before.getMonth(), 1),
          endDate: endOfMonth(before.getFullYear(), before.getMonth()),
          label: "Bir önceki ay",
        },
      }
    }
    case "bu-ceyrek": {
      const quarterStart = Math.floor(m / 3) * 3
      const prevQuarter = new Date(y, quarterStart - 3, 1)
      return {
        startDate: day(y, quarterStart, 1),
        endDate: endOfMonth(y, quarterStart + 2),
        label: "Bu Çeyrek",
        previous: {
          startDate: day(prevQuarter.getFullYear(), prevQuarter.getMonth(), 1),
          endDate: endOfMonth(prevQuarter.getFullYear(), prevQuarter.getMonth() + 2),
          label: "Önceki çeyrek",
        },
      }
    }
    case "gecen-yil":
      return {
        startDate: day(y - 1, 0, 1),
        endDate: day(y - 1, 11, 31),
        label: "Geçen Yıl",
        previous: {
          startDate: day(y - 2, 0, 1),
          endDate: day(y - 2, 11, 31),
          label: `${y - 2}`,
        },
      }
    case "bu-yil":
      return {
        startDate: day(y, 0, 1),
        endDate: day(y, 11, 31),
        label: "Bu Yıl",
        previous: {
          startDate: day(y - 1, 0, 1),
          endDate: day(y - 1, 11, 31),
          label: `${y - 1}`,
        },
      }
    case "bu-ay":
    default: {
      const before = new Date(y, m - 1, 1)
      return {
        startDate: day(y, m, 1),
        endDate: endOfMonth(y, m),
        label: "Bu Ay",
        previous: {
          startDate: day(before.getFullYear(), before.getMonth(), 1),
          endDate: endOfMonth(before.getFullYear(), before.getMonth()),
          label: "Geçen ay",
        },
      }
    }
  }
}

/**
 * Yüzde değişim. Önceki dönem SIFIRSA oran tanımsızdır (null döner) — 0'a
 * bölüp `Infinity` basmak ekranda "%∞ artış" gibi görünüyordu.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}
