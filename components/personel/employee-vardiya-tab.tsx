"use client"

/**
 * Personel kartının VARDİYA sekmesi — bu kişinin bir aylık çalışma kaydı.
 *
 * Takvim (`/personel/vardiya`) işletmenin tamamına, puantaj (`/personel/puantaj`)
 * aylık toplamlara bakar; burası tek kişinin GÜN GÜN dökümü: hangi gün hangi
 * saatte planlandı, geldi mi. "Bu adam bu ay ne yaptı" sorusunun cevabı İK
 * kartından çıkmıyordu.
 *
 * Fiilî giriş/çıkış YOK: personelin planına uyduğu varsayılır, yalnız gelmediği
 * ayrıca işaretlenir.
 *
 * Veriyi kendi çeker (ay gezinmesi kendi içinde), böylece kart açılırken ağır
 * bir istek eklemez — sekmeye girilmedikçe hiçbir şey yüklenmez.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { dayTitle, durationLabel, minuteToHHMM, netMinutes } from "@/lib/personel/vardiya"

type Shift = {
  id: string
  workDate: string
  plannedStart: number
  plannedEnd: number
  breakMinutes: number
  status: string
  templateName: string | null
  note: string | null
}

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

export function EmployeeVardiyaTab({
  employeeId,
  companyId,
}: {
  employeeId: string
  companyId: string | null
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const pad = String(month).padStart(2, "0")
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
      const res = await fetch(
        `/api/personel/shifts?companyId=${companyId}&employeeId=${employeeId}` +
          `&from=${year}-${pad}-01&to=${year}-${pad}-${lastDay}`,
      )
      if (res.ok) setShifts(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId, employeeId, year, month])

  useEffect(() => {
    load()
  }, [load])

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  /**
   * Aylık toplamlar PLANDAN türer.
   *
   * Fiilî giriş/çıkış takibi yapılmıyor: personelin planına uyduğu varsayılır ve
   * yalnız GELMEDİĞİ ayrıca işaretlenir. Bu yüzden "çalışılan" süre, devamsız
   * günler düşülmüş plandır — damgasız kaldığı için eksik görünen bir "fiilî"
   * sütunu, olmayan bir veriyi eksik gibi gösteriyordu.
   */
  const totals = useMemo(() => {
    const acc = { planned: 0, worked: 0, absent: 0 }
    for (const s of shifts) {
      const minutes = netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes)
      acc.planned += minutes
      if (s.status === "ABSENT") acc.absent++
      else acc.worked += minutes
    }
    return acc
  }, [shifts])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-semibold">
            {AYLAR[month - 1]} {year}
          </span>
          <Button variant="outline" size="icon" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{shifts.length} vardiya</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Planlanan" value={durationLabel(totals.planned)} />
        <Tile
          label="Çalışılan"
          value={durationLabel(totals.worked)}
          hint={totals.absent > 0 ? "devamsız günler düşülmüş" : undefined}
        />
        <Tile
          label="Devamsızlık"
          value={totals.absent > 0 ? `${totals.absent} gün` : "—"}
          tone={totals.absent > 0 ? "warn" : undefined}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Yükleniyor...
        </div>
      ) : shifts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Bu ay için vardiya kaydı yok.
        </p>
      ) : (
        <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                <StyledTableHead>Gün</StyledTableHead>
                <StyledTableHead>Vardiya</StyledTableHead>
                <StyledTableHead>Saat</StyledTableHead>
                <StyledTableHead className="text-right">Net</StyledTableHead>
                <StyledTableHead>Durum</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {shifts.map((s) => {
                const absent = s.status === "ABSENT"
                const minutes = netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes)
                return (
                  <StyledTableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {dayTitle(s.workDate)}
                    </TableCell>
                    <TableCell className="text-xs">{s.templateName || "—"}</TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap text-xs tabular-nums",
                        absent && "line-through opacity-60",
                      )}
                    >
                      {minuteToHHMM(s.plannedStart)}–{minuteToHHMM(s.plannedEnd)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold tabular-nums">
                      {absent ? "—" : durationLabel(minutes)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {absent ? (
                        <span className="text-red-600 dark:text-red-400">Gelmedi</span>
                      ) : (
                        <span className="text-muted-foreground">Planlandı</span>
                      )}
                    </TableCell>
                  </StyledTableRow>
                )
              })}
            </TableBody>
          </Table>
        </StyledTableContainer>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "good" | "warn"
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-lg font-bold tabular-nums",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
          )}
        >
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}
