"use client"

/**
 * Vardiya listesi — dar ekran görünümü.
 *
 * Izgara telefonda kullanılabilir DEĞİL: gün görünümü 208px ad sütunu + saat
 * başına 58px ile yatay kaydırma zorunlu kılıyor, hafta ızgarası ise `min-w`
 * 840px. Yöneticinin telefonu ise takvime en çok bakılan cihaz.
 *
 * Burada saat EKSENİ YOK, yalnız sıralı liste var — dar ekranda bir saatin
 * konumunu piksel olarak göstermeye çalışmak, hem okunmaz hem de dokunmatikte
 * sürüklenemez bir ızgara üretiyordu. Düzenleme dokunarak açılan pencereden
 * yapılır; jestin karşılığı burada yok, çünkü telefonda 15 dakikalık bir hedefe
 * parmakla isabet etmek gerçekçi değil.
 */

import { cn } from "@/lib/utils"
import { AlertTriangle, Plus } from "lucide-react"
import { durationLabel, minuteToHHMM, netMinutes, shortDayLabel } from "@/lib/personel/vardiya"
import { barClass, softBarClass } from "@/components/personel/shift-colors"
import type { WeekShift } from "@/components/personel/vardiya-hafta"

export function VardiyaMobil({
  days,
  employees,
  shifts,
  leaveDays,
  holidays,
  today,
  onOpenShift,
  onAddShift,
}: {
  /** Tek gün ([day]) ya da haftanın yedi günü — üstteki görünüm anahtarı belirler. */
  days: string[]
  employees: { id: string; name: string; department?: string | null; position?: string | null }[]
  shifts: WeekShift[]
  leaveDays: Map<string, string>
  holidays: Map<string, string>
  today: string
  onOpenShift: (shift: WeekShift) => void
  onAddShift: (employeeId: string, day: string) => void
}) {
  return (
    <div className="space-y-4">
      {days.map((day) => {
        const dayShifts = shifts
          .filter((s) => s.workDate === day)
          .sort((a, b) => a.plannedStart - b.plannedStart)
        const holiday = holidays.get(day)
        // İzinliler ayrı bölümde: vardiya listesinin arasına karışsalardı "kim
        // çalışıyor" sorusunun cevabı sayılamaz hale gelirdi.
        const onLeave = employees.filter((e) => leaveDays.has(`${e.id}|${day}`))
        const total = dayShifts.reduce(
          (sum, s) => sum + netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes),
          0,
        )

        return (
          <div key={day} className="overflow-hidden rounded-xl border border-border/70 bg-card">
            <div
              className={cn(
                "flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2",
                holiday
                  ? "bg-rose-500/[0.07]"
                  : day === today
                    ? "bg-kobipo-blue/[0.06] dark:bg-primary/10"
                    : "bg-muted/40",
              )}
            >
              <div>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    day === today && "text-kobipo-blue dark:text-primary",
                  )}
                >
                  {shortDayLabel(day)}
                </p>
                {holiday && (
                  <p className="text-[11px] font-medium text-rose-700 dark:text-rose-400">
                    {holiday}
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {dayShifts.length > 0 ? `${dayShifts.length} vardiya · ${durationLabel(total)}` : "boş"}
              </span>
            </div>

            <div className="divide-y divide-border/50">
              {dayShifts.map((s) => {
                const employee = employees.find((e) => e.id === s.employeeId)
                const absent = s.status === "ABSENT"
                const index = employees.findIndex((e) => e.id === s.employeeId)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onOpenShift(s)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <span
                      className={cn(
                        "h-8 w-1.5 shrink-0 rounded-full",
                        absent ? softBarClass(s.color, index) : barClass(s.color, index),
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {employee?.name ?? "—"}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {s.templateName || employee?.position || employee?.department || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={cn(
                          "block text-sm font-semibold tabular-nums",
                          absent && "line-through opacity-60",
                        )}
                      >
                        {minuteToHHMM(s.plannedStart)}–{minuteToHHMM(s.plannedEnd)}
                      </span>
                      {absent ? (
                        <span className="flex items-center justify-end gap-0.5 text-[11px] text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3" />
                          Gelmedi
                        </span>
                      ) : (
                        <span className="block text-[11px] text-muted-foreground">
                          {durationLabel(netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes))}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}

              {onLeave.map((e) => (
                <p
                  key={e.id}
                  className="flex items-center justify-between px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
                >
                  <span className="truncate">{e.name}</span>
                  <span className="shrink-0 font-medium">{leaveDays.get(`${e.id}|${day}`)}</span>
                </p>
              ))}

              {dayShifts.length === 0 && onLeave.length === 0 && (
                <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Bu gün için vardiya yok.
                </p>
              )}
            </div>

            {employees.length > 0 && (
              <button
                type="button"
                onClick={() => onAddShift(employees[0].id, day)}
                className="flex w-full items-center justify-center gap-1 border-t border-border/50 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> Vardiya ekle
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
