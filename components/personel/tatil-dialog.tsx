"use client"

/**
 * İşletme tatilleri — işveren kendi belirler.
 *
 * Sabit tarihli resmî tatiller tek tuşla eklenir; Ramazan/Kurban gibi KAYAN
 * bayramlar listede yoktur ve elle girilir. Gerekçe kullanıcıya da yazılı:
 * yanlış tarihte gömülü bir bayram, tatil planını sessizce bozar.
 */

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { hhmmToMinute, minuteToHHMM, weekdayLabel, weekdayOf } from "@/lib/personel/vardiya"
import { currentYear, type Holiday } from "@/lib/personel/tatil"

export function TatilDialog({
  open,
  holidays,
  isSaving,
  onClose,
  onCreate,
  onDelete,
  onSeed,
}: {
  open: boolean
  holidays: Holiday[]
  isSaving: boolean
  onClose: () => void
  onCreate: (h: { name: string; date: string; recurring: boolean; halfDayFrom: number | null }) => void
  onDelete: (id: string) => void
  onSeed: (year: number) => void
}) {
  const [year, setYear] = useState(currentYear())
  const [name, setName] = useState("")
  const [date, setDate] = useState(`${currentYear()}-01-01`)
  const [recurring, setRecurring] = useState(false)
  const [halfDay, setHalfDay] = useState(false)
  const [halfDayFrom, setHalfDayFrom] = useState("13:00")
  const [error, setError] = useState<string | null>(null)

  /** Listede o yılın günleri gösterilir; tekrar edenler her yıl görünür. */
  const visible = useMemo(
    () =>
      holidays
        .map((h) => ({ ...h, shown: h.recurring ? `${year}-${h.date.slice(5)}` : h.date }))
        .filter((h) => h.shown.startsWith(String(year)))
        .sort((a, b) => a.shown.localeCompare(b.shown)),
    [holidays, year],
  )

  if (!open) return null

  function add() {
    if (!name.trim()) {
      setError("Tatil adı girin")
      return
    }
    const from = halfDay ? hhmmToMinute(halfDayFrom) : null
    if (halfDay && from == null) {
      setError("Yarım gün saati SS:DD olmalı")
      return
    }
    setError(null)
    onCreate({ name: name.trim(), date, recurring, halfDayFrom: from })
    setName("")
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tatil günleri</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>
              ‹
            </Button>
            <span className="min-w-[4rem] text-center text-sm font-semibold">{year}</span>
            <Button variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>
              ›
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => onSeed(year)} disabled={isSaving}>
            <Sparkles className="mr-1 h-4 w-4" /> Resmî tatilleri ekle
          </Button>
        </div>

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              {year} için tatil tanımlı değil.
            </p>
          ) : (
            visible.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
              >
                <span className="flex-1 truncate text-sm font-medium">{h.name}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {formatDay(h.shown)}
                  {h.recurring && <span className="ml-1 opacity-70">· her yıl</span>}
                  {h.halfDayFrom != null && (
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      · {minuteToHHMM(h.halfDayFrom)} sonrası
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(h.id)}
                  disabled={isSaving}
                  className="h-8 w-8 text-muted-foreground hover:text-red-600"
                  title="Tatili kaldır"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
          <p className="text-sm font-semibold">Yeni tatil</p>
          <p className="text-[11px] text-muted-foreground">
            Ramazan ve Kurban Bayramı ay takvimine göre kaydığı için hazır listede yok;
            buradan yılına göre ekleyin ve <span className="font-medium">her yıl tekrar</span>{" "}
            işaretlemeyin.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tatil-ad">Ad</Label>
              <Input
                id="tatil-ad"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ramazan Bayramı 1. Gün"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tatil-tarih">Tarih</Label>
              <Input
                id="tatil-tarih"
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-kobipo-blue"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
              />
              Her yıl tekrar eder
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-kobipo-blue"
                checked={halfDay}
                onChange={(e) => setHalfDay(e.target.checked)}
              />
              Yarım gün
            </label>
            {halfDay && (
              <Input
                type="time"
                className="h-9 w-28"
                value={halfDayFrom}
                onChange={(e) => setHalfDayFrom(e.target.value)}
              />
            )}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <Button onClick={add} disabled={isSaving} size="sm">
            {isSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            Tatil ekle
          </Button>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** "2026-10-29" → "29 Ekim · Perşembe" */
function formatDay(day: string) {
  const [y, m, d] = day.split("-").map(Number)
  const label = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
  })
  return `${label} · ${weekdayLabel(weekdayOf(day))}`
}
