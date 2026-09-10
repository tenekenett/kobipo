"use client"

/**
 * Devam takviminin haftalık ızgarası: satır = personel, sütun = gün.
 *
 * Saf gösterim — veri ve yazma sayfada (`app/(dashboard)/personel/devam`). Hücre
 * durumunun nereden geldiği (`source`) burada GÖRÜNÜR olmak zorunda: elle
 * işaretlenmiş gün dolu, türetilmiş gün soluk ve kesikli çizilir. Aksi halde
 * kullanıcı izin modülünden gelen bir günü kendi işaretlemesi sanır ve "ben
 * böyle yazmamıştım" itirazının cevabı kalmaz.
 */

import { Paintbrush } from "lucide-react"
import { cn } from "@/lib/utils"
import { DEVAM_CELL_CLASS, DEVAM_CELL_SOFT } from "@/components/personel/devam-renkleri"
import { DEVAM_STATUS, type DevamCell, type DevamStatus } from "@/lib/personel/devam"
import { shortDayLabel } from "@/lib/personel/vardiya"

export type DevamRowData = {
  employeeId: string
  name: string
  subtitle?: string | null
  cells: DevamCell[]
  workedDays: number
  deductionDays: number
}

export function DevamHafta({
  days,
  rows,
  holidayNames,
  canWrite,
  onCellClick,
  onRowFill,
  onEmployeeClick,
}: {
  days: string[]
  rows: DevamRowData[]
  /** "YYYY-MM-DD" → tatil adı; sütun başlığında rozet olarak çizilir. */
  holidayNames: Map<string, string>
  canWrite: boolean
  onCellClick: (employeeId: string, day: string, cell: DevamCell) => void
  onRowFill: (employeeId: string) => void
  /** İsme tıklanınca — çalışma düzeni penceresi (vardiya takvimiyle aynı jest). */
  onEmployeeClick?: (employeeId: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-48 bg-background px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
              Personel
            </th>
            {days.map((day) => {
              const holiday = holidayNames.get(day)
              return (
                <th key={day} className="px-1 py-2 text-center text-xs font-semibold">
                  <div>{shortDayLabel(day)}</div>
                  {holiday && (
                    <div
                      className="truncate text-[10px] font-normal text-cyan-700 dark:text-cyan-300"
                      title={holiday}
                    >
                      {holiday}
                    </div>
                  )}
                </th>
              )
            })}
            <th className="px-2 py-2 text-right text-xs font-semibold text-muted-foreground">
              Çalışılan / Kesinti
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.employeeId} className="align-middle">
              <td className="sticky left-0 z-10 max-w-48 bg-background px-3 py-1.5">
                <div className="flex items-center gap-1.5">
                  {/* İSİM = kişinin çalışma düzeni (vardiya takvimiyle aynı jest),
                      FIRÇA DÜĞMESİ = haftanın tamamına seçili durumu uygula. İki
                      farklı iş aynı tıklamaya bindirilmemeli: biri kişiyi başka
                      takvime taşır, öteki yedi güne kayıt yazar. */}
                  <button
                    type="button"
                    onClick={() => onEmployeeClick?.(row.employeeId)}
                    disabled={!canWrite || !onEmployeeClick}
                    className="block min-w-0 flex-1 truncate text-left font-medium text-kobipo-blue hover:underline disabled:cursor-default disabled:text-foreground disabled:no-underline dark:text-primary"
                    title={canWrite ? "Çalışma düzenini değiştir" : row.name}
                  >
                    {row.name}
                  </button>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => onRowFill(row.employeeId)}
                      title="Haftanın çalışma günlerine seçili durumu uygula"
                      className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      <Paintbrush className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {row.subtitle && (
                  <div className="truncate text-[11px] text-muted-foreground">{row.subtitle}</div>
                )}
              </td>
              {row.cells.map((cell, i) => (
                <td key={days[i]} className="p-0.5">
                  <DevamHucre
                    cell={cell}
                    canWrite={canWrite}
                    onClick={() => onCellClick(row.employeeId, days[i], cell)}
                  />
                </td>
              ))}
              <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums">
                <span className="font-semibold">{gun(row.workedDays)}</span>
                <span className="text-muted-foreground"> / </span>
                <span
                  className={cn(
                    row.deductionDays > 0
                      ? "font-semibold text-rose-600 dark:text-rose-400"
                      : "text-muted-foreground",
                  )}
                >
                  {gun(row.deductionDays)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DevamHucre({
  cell,
  canWrite,
  onClick,
}: {
  cell: DevamCell
  canWrite: boolean
  onClick: () => void
}) {
  // İstihdam dışı gün (işe girişten önce / çıkıştan sonra): tıklanamaz ve hiçbir
  // sayıma girmez. Boş bırakmak yetmez, kullanıcı "işaretlemeyi unuttum" sanardı.
  if (!cell.status) {
    return (
      <div className="flex h-9 items-center justify-center rounded-md border border-dashed border-border/60 text-[10px] text-muted-foreground/60">
        ·
      </div>
    )
  }
  const def = DEVAM_STATUS[cell.status]
  const marked = cell.source === "record"
  const title = [
    def.label,
    marked ? "elle işaretlendi" : KAYNAK_ETIKET[cell.source],
    cell.note || null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canWrite}
      title={title}
      className={cn(
        "flex h-9 w-full items-center justify-center rounded-md text-xs font-semibold transition",
        marked ? DEVAM_CELL_CLASS[cell.status] : DEVAM_CELL_SOFT[cell.status],
        !marked && "border border-dashed border-current/30",
        canWrite ? "hover:opacity-80" : "cursor-default",
      )}
    >
      {def.short}
    </button>
  )
}

const KAYNAK_ETIKET: Record<string, string> = {
  leave: "izin kaydından geldi",
  holiday: "işletme tatili",
  closed: "açılış saatlerinde kapalı",
  default: "varsayılan",
  employment: "istihdam dışı",
}

/** 2.5 → "2,5 gün" · 3 → "3 gün" */
const gun = (n: number) =>
  `${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün`
