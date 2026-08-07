"use client"

/**
 * İşletmenin haftalık açılış saati (Company.openingHours).
 *
 * Vardiya takviminin en üst satırından açılır — ayrı bir ayar ekranına gitmeye
 * gerek kalmasın diye. Takvimdeki gölge bant ve "bu gün kapalı" durumu buradan
 * beslenir.
 */

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Loader2 } from "lucide-react"
import {
  DEFAULT_OPENING_HOURS,
  type OpeningHours,
} from "@/lib/personel/opening-hours"
import { DAY_MINUTES, hhmmToMinute, minuteToHHMM, weekdayLabel } from "@/lib/personel/vardiya"

/** Pazartesi'den başlayan gösterim sırası; dizideki indis Date.getDay() ile aynı kalır. */
const ORDER = [1, 2, 3, 4, 5, 6, 0]

export function AcilisSaatiDialog({
  open,
  value,
  isSaving,
  onClose,
  onSave,
}: {
  open: boolean
  value: OpeningHours | null
  isSaving: boolean
  onClose: () => void
  onSave: (next: OpeningHours) => void
}) {
  const [rows, setRows] = useState<OpeningHours>(DEFAULT_OPENING_HOURS)
  // Gece kapanışı (>24:00) `type="time"` ile gösterilemediği için günlük ayrı anahtar.
  const [nextDay, setNextDay] = useState<boolean[]>(() => Array(7).fill(false))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const base = value ?? DEFAULT_OPENING_HOURS
    setRows(base)
    setNextDay(base.map((d) => d.end > DAY_MINUTES))
    setError(null)
  }, [open, value])

  if (!open) return null

  const patch = (weekday: number, next: Partial<OpeningHours[number]>) =>
    setRows((prev) => prev.map((d, i) => (i === weekday ? { ...d, ...next } : d)))

  function submit() {
    for (const weekday of ORDER) {
      const d = rows[weekday]
      if (d.closed) continue
      if (d.end <= d.start) {
        setError(`${weekdayLabel(weekday)}: kapanış açılıştan sonra olmalı`)
        return
      }
    }
    setError(null)
    onSave(rows)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Açılış saati</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {ORDER.map((weekday) => {
            const d = rows[weekday]
            return (
              <div
                key={weekday}
                className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
              >
                <span className="w-24 shrink-0 text-sm font-medium">{weekdayLabel(weekday)}</span>
                <Switch
                  checked={!d.closed}
                  onCheckedChange={(on) => patch(weekday, { closed: !on })}
                />
                {d.closed ? (
                  <span className="text-sm text-muted-foreground">Kapalı</span>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      type="time"
                      className="h-9 w-28"
                      value={minuteToHHMM(d.start)}
                      onChange={(ev) => {
                        const m = hhmmToMinute(ev.target.value)
                        if (m != null) patch(weekday, { start: m })
                      }}
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="time"
                      className="h-9 w-28"
                      value={minuteToHHMM(d.end)}
                      onChange={(ev) => {
                        const m = hhmmToMinute(ev.target.value)
                        if (m != null) patch(weekday, { end: m + (nextDay[weekday] ? DAY_MINUTES : 0) })
                      }}
                    />
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-kobipo-blue"
                        checked={nextDay[weekday]}
                        onChange={(ev) => {
                          const on = ev.target.checked
                          setNextDay((prev) => prev.map((v, i) => (i === weekday ? on : v)))
                          const base = d.end % DAY_MINUTES
                          patch(weekday, { end: on ? base + DAY_MINUTES : base })
                        }}
                      />
                      ertesi gün
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kaydet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
