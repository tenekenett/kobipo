"use client"

/**
 * Kapsama şeridi — ızgaranın altında, aynı saat ekseninde.
 *
 * İKİ EĞRİ ÜST ÜSTE: dolu alan o saatte KAÇ KİŞİ çalıştığını, arkadaki soluk
 * çizgi ise geçmiş haftalarda o saatte NE KADAR İŞ olduğunu gösterir. Takvimin
 * bugüne kadarki eksiği tam olarak buydu: "kim çalışıyor" görünüyordu ama
 * "yetiyor mu" görünmüyordu; iki eğrinin ayrıştığı saat, planın düzeltilmesi
 * gereken saattir.
 *
 * Eksen üstteki ızgarayla AYNI pencereyi (win.from–win.to) kullanır — kaymış bir
 * eksen, iki grafiği yan yana okunamaz hale getirirdi.
 *
 * Talep eğrisi KENDİ İÇİNDE ölçeklenir (en yoğun saat = tavan) ve sayı olarak
 * yazılmaz: "ortalama 12,4 adisyon" diye bir hedef yok, sorulan şey biçimin
 * personel eğrisiyle örtüşüp örtüşmediği.
 */

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { DAY_MINUTES, minuteToHHMM } from "@/lib/personel/vardiya"

export type CoverageShift = {
  plannedStart: number
  plannedEnd: number
  status?: string
}

/** Saat başına ortalama yoğunluk — talep ucundan gelir. */
export type DemandHour = { hour: number; tickets: number; guests: number }

/** Kaç dakikalık dilimlerle örneklenecek. 30 dk: yarım saatlik kaymalar görünür, dizi kısa kalır. */
const STEP = 30

export function VardiyaKapsama({
  shifts,
  window: win,
  demand,
  sampleDays,
  nameWidth,
}: {
  shifts: CoverageShift[]
  window: { from: number; to: number }
  /** Restoran modülü kapalıysa ya da veri yoksa boş; şerit yalnız personeli çizer. */
  demand?: DemandHour[]
  sampleDays?: number
  /** Üstteki ızgaranın ad sütunu genişliği — eksenlerin hizalanması için. */
  nameWidth: number
}) {
  const slots = useMemo(() => {
    const list: { minute: number; count: number }[] = []
    for (let m = win.from; m < win.to; m += STEP) {
      // Dilimin ORTASI örneklenir: sınırda başlayan/biten vardiya, dilimin
      // tamamını doldurmadığı halde sayılmasın.
      const mid = m + STEP / 2
      const count = shifts.filter(
        (s) => s.status !== "ABSENT" && s.plannedStart <= mid && mid < s.plannedEnd,
      ).length
      list.push({ minute: m, count })
    }
    return list
  }, [shifts, win.from, win.to])

  const peak = Math.max(1, ...slots.map((s) => s.count))

  /**
   * Talep, personel eğrisiyle aynı dilimlere yayılır.
   *
   * Saat verisi 0–23 aralığında gelir; ızgara ise 1440'ı aşabilir (gece
   * vardiyası). Bu yüzden dilim dakikası güne indirgenerek eşleşme kurulur —
   * aksi halde gece 01:00 dilimi hiçbir saate denk gelmez ve şerit orada kesilirdi.
   */
  const demandByMinute = useMemo(() => {
    if (!demand || demand.length === 0) return null
    const byHour = new Map(demand.map((d) => [d.hour, d.guests]))
    const values = slots.map((s) => byHour.get(Math.floor((s.minute % DAY_MINUTES) / 60)) ?? 0)
    const max = Math.max(...values)
    return max > 0 ? values.map((v) => v / max) : null
  }, [demand, slots])

  const hasDemand = demandByMinute != null

  return (
    <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
      <div className="flex" style={{ minWidth: nameWidth + slots.length * 24 }}>
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border/70 bg-card px-3 py-2"
          style={{ width: nameWidth }}
        >
          <p className="text-xs font-semibold">Kapsama</p>
          <p className="text-[11px] text-muted-foreground">
            en yoğun {peak} kişi
            {hasDemand && sampleDays ? ` · ${sampleDays} günlük yoğunluk` : ""}
          </p>
        </div>

        <div className="relative flex flex-1 items-end gap-px py-2 pr-1" style={{ height: 84 }}>
          {slots.map((s, i) => {
            const ratio = s.count / peak
            const demandRatio = demandByMinute?.[i] ?? 0
            return (
              <div key={s.minute} className="group relative flex-1" style={{ height: "100%" }}>
                {/* Talep: arkada duran soluk sütun. Personel çubuğunun ARKASINDA
                    çünkü sorulan şey "plan talebi karşılıyor mu" — okunması
                    gereken önce plan. */}
                {hasDemand && (
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-muted-foreground/15"
                    style={{ height: `${Math.max(2, demandRatio * 100)}%` }}
                  />
                )}
                <div
                  className={cn(
                    "absolute bottom-0 left-0 right-0 rounded-t-sm transition-colors",
                    s.count === 0
                      ? "bg-transparent"
                      : // Talep varken personelin belirgin biçimde geride kaldığı
                        // dilim ayrı renkte: göz o saati aramak zorunda kalmasın.
                        hasDemand && demandRatio - ratio > 0.34
                        ? "bg-amber-500/70"
                        : "bg-kobipo-blue/60 dark:bg-primary/60",
                  )}
                  style={{ height: `${ratio * 100}%` }}
                />
                <span className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] text-background group-hover:block">
                  {minuteToHHMM(s.minute)} · {s.count} kişi
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
