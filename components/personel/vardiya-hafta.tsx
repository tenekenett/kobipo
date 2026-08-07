"use client"

/**
 * Vardiya takvimi — hafta görünümü.
 *
 * Gün görünümü "bugün kim ne zaman"ı gösterir; planlama pratikte burada yapılır:
 * 7 gün × personel ızgarası, hücrede o günün vardiya çipleri. Saat hassasiyeti
 * yerine kapsama bakılır — kimin hangi günü boş kaldığı buradan görünür.
 *
 * Sürükleme YOK: hücre genişliği bir günü temsil ettiği için yatay sürükleme
 * saat değil gün anlamına gelirdi ve gün görünümündeki jestle çelişirdi. Tıklama
 * düzenleme penceresini açar.
 */

import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"
import {
  deviationLabel,
  durationLabel,
  minuteToHHMM,
  netMinutes,
  weekdayLabel,
  weekdayOf,
} from "@/lib/personel/vardiya"
import { barClass, softBarClass } from "@/components/personel/shift-colors"

export type WeekShift = {
  id: string
  employeeId: string
  workDate: string
  plannedStart: number
  plannedEnd: number
  actualStart?: number | null
  actualEnd?: number | null
  status?: string
  breakMinutes: number
  color?: string | null
  templateName?: string | null
}

export type WeekEmployee = { id: string; name: string; department?: string | null; position?: string | null }

/** Gün başlığı: "Pzt 4" — dar sütunda tam ad sığmıyor. */
const shortDay = (day: string) => {
  const [, , d] = day.split("-")
  return `${weekdayLabel(weekdayOf(day)).slice(0, 3)} ${Number(d)}`
}

export function VardiyaHafta({
  days,
  employees,
  shifts,
  leaveDays,
  holidays,
  today,
  onOpenShift,
  onAddShift,
}: {
  days: string[]
  employees: WeekEmployee[]
  shifts: WeekShift[]
  /** "employeeId|gün" → izin etiketi. */
  leaveDays: Map<string, string>
  /** "gün" → tatil adı. Sütun başlığında ve hücre zemininde görünür. */
  holidays: Map<string, string>
  today: string
  onOpenShift: (shift: WeekShift) => void
  onAddShift: (employeeId: string, day: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
      <div className="min-w-[840px]">
        <div className="flex border-b border-border/70 bg-muted/40">
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-border/70 bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground"
            style={{ width: 208 }}
          >
            Personel
          </div>
          {days.map((d) => {
            const holiday = holidays.get(d)
            return (
              <div
                key={d}
                title={holiday}
                className={cn(
                  "flex-1 border-r border-border/40 px-2 py-2 text-center text-xs font-semibold last:border-r-0",
                  holiday
                    ? "text-rose-700 dark:text-rose-400"
                    : d === today
                      ? "text-kobipo-blue dark:text-primary"
                      : "text-muted-foreground",
                )}
              >
                {shortDay(d)}
                {holiday && <p className="truncate text-[10px] font-normal">{holiday}</p>}
              </div>
            )
          })}
        </div>

        {employees.map((emp, i) => {
          const total = shifts
            .filter((s) => s.employeeId === emp.id)
            .reduce((sum, s) => sum + netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes), 0)
          return (
            <div key={emp.id} className="flex border-b border-border/50 last:border-b-0">
              <div
                className="sticky left-0 z-20 shrink-0 border-r border-border/70 bg-card px-3 py-2"
                style={{ width: 208 }}
              >
                <p className="truncate text-sm font-medium">{emp.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {/* Haftalık toplam: fazla mesai kuralı henüz yok, ham süre. */}
                  {total > 0 ? `haftalık ${durationLabel(total)}` : "vardiya yok"}
                </p>
              </div>
              {days.map((day) => {
                const cellShifts = shifts.filter((s) => s.employeeId === emp.id && s.workDate === day)
                const leave = leaveDays.get(`${emp.id}|${day}`)
                return (
                  <div
                    key={day}
                    className={cn(
                      "group relative min-h-[58px] flex-1 space-y-1 border-r border-border/40 p-1 last:border-r-0",
                      // Tatil zemini bugünün vurgusunu EZER: tatilde vardiya
                      // planlamak istisnadır, önce o görünmeli.
                      holidays.has(day)
                        ? "bg-rose-500/[0.06] dark:bg-rose-400/10"
                        : day === today && "bg-kobipo-blue/[0.04] dark:bg-primary/10",
                    )}
                  >
                    {leave && (
                      <div className="rounded bg-amber-500/10 px-1 py-0.5 text-center text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400">
                        {leave}
                      </div>
                    )}
                    {cellShifts.map((s) => {
                      const absent = s.status === "ABSENT"
                      const stamped = s.actualStart != null && s.actualEnd != null
                      const deviation = deviationLabel(s)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onOpenShift(s)}
                          title={
                            [s.templateName, deviation, absent ? "Gelmedi" : null]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          }
                          className={cn(
                            "block w-full truncate rounded px-1.5 py-1 text-[11px] font-semibold tabular-nums",
                            // Damgalı vardiya FİİLÎ saatini gösterir: hafta ızgarasında
                            // asıl soru "planlandı mı" değil, "ne oldu".
                            absent ? softBarClass(s.color, i) : barClass(s.color, i),
                            absent && "line-through opacity-70",
                          )}
                        >
                          {stamped
                            ? `${minuteToHHMM(s.actualStart!)}–${minuteToHHMM(s.actualEnd!)}`
                            : `${minuteToHHMM(s.plannedStart)}–${minuteToHHMM(s.plannedEnd)}`}
                          {deviation && <span className="ml-1 font-normal opacity-90">!</span>}
                        </button>
                      )
                    })}
                    {/* Boş hücrede yalnız üzerine gelince görünen ekleme düğmesi:
                        her hücrede duran bir "+" ızgarayı okunamaz hale getiriyordu. */}
                    <button
                      type="button"
                      onClick={() => onAddShift(emp.id, day)}
                      className={cn(
                        "flex w-full items-center justify-center rounded border border-dashed border-border py-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100",
                        cellShifts.length === 0 && "opacity-40",
                      )}
                      title="Vardiya ekle"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
