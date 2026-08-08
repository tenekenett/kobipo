"use client"

// Kontrol listesi uyum raporu — "hangi gün hangi madde eksik kaldı".
//
// Liste satışı bloklamadığı ve tik doğrulanmadığı için özelliğin TEK yaptırım
// gücü bu ekrandır: patron eksikleri burada görür. O yüzden rapor günlük dökümle
// yetinmiyor, "en çok atlanan madde" özetini de basıyor — asıl aranan cevap o.

import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RangeBar, ReportState, StatTile, useReport, useReportRange } from "@/components/restoran/report-ui"
import { CHECKLIST_TYPE_LABELS } from "@/lib/restoran/checklist"
import { cn } from "@/lib/utils"

type Cell = { total: number; done: number; missing: string[] }

type Data = {
  from: string
  to: string
  days: {
    date: string
    opening: Cell
    closing: Cell
    /** O gün HİÇ tik atılmamış — mekân kapalı da olabilir. */
    untouched: boolean
  }[]
  items: { id: string; type: "OPENING" | "CLOSING"; title: string; expectedDays: number; doneDays: number }[]
  employees: { name: string; count: number }[]
}

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    weekday: "short",
  })
}

export function ChecklistComplianceReport({ companyId }: { companyId: string }) {
  const range = useReportRange("month")

  // Kendi sorgu dizesi: uç GÜN bekliyor ("YYYY-MM-DD"), `range.query` ise tam
  // ISO damgası üretiyor (fatura tarihleri zaman taşır, kontrol listesi taşımaz).
  const { data, error, isLoading } = useReport<Data>(
    "/api/restoran/kontrol-listesi/rapor",
    companyId,
    `startDate=${range.from}&endDate=${range.to}`,
  )

  const days = data?.days ?? []
  // Kapalı olabilecek günler (hiç tik yok) ORANIN DIŞINDA: pazartesi kapalı bir
  // kafede uyum yüzdesi her hafta kendiliğinden düşerdi.
  const counted = days.filter((day) => !day.untouched)
  const expected = counted.reduce((sum, day) => sum + day.opening.total + day.closing.total, 0)
  const done = counted.reduce((sum, day) => sum + day.opening.done + day.closing.done, 0)
  const fullDays = counted.filter(
    (day) => day.opening.done === day.opening.total && day.closing.done === day.closing.total,
  ).length

  return (
    <div className="space-y-4">
      <RangeBar range={range} />

      <ReportState
        isLoading={isLoading}
        error={error}
        empty={days.length === 0}
        emptyText="Bu aralıkta kayıt yok."
      />

      {!isLoading && !error && days.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Tamamlanan gün"
              value={`${fullDays}/${counted.length}`}
              hint="her iki liste tam"
              tone={fullDays === counted.length ? "good" : "warn"}
            />
            <StatTile
              label="Onaylanan madde"
              value={expected > 0 ? `%${Math.round((done / expected) * 100)}` : "—"}
              hint={`${done}/${expected} madde`}
              tone={expected > 0 && done === expected ? "good" : "default"}
            />
            <StatTile
              label="Hiç onay olmayan gün"
              value={String(days.length - counted.length)}
              hint="kapalı gün olabilir"
            />
          </div>

          {data && data.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">En çok atlanan maddeler</CardTitle>
                <CardDescription>
                  Madde listeye EKLENDİĞİ günden itibaren sayılır; daha eski günler eksik gösterilmez.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StyledTableContainer>
                  <Table>
                    <TableHeader>
                      <StyledTableHeaderRow>
                        <StyledTableHead>Madde</StyledTableHead>
                        <StyledTableHead>Liste</StyledTableHead>
                        <StyledTableHead className="text-right">Onaylandı</StyledTableHead>
                        <StyledTableHead className="text-right">Atlandı</StyledTableHead>
                      </StyledTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((item) => {
                        const missed = item.expectedDays - item.doneDays
                        return (
                          <StyledTableRow key={item.id}>
                            <TableCell className="font-medium">{item.title}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {CHECKLIST_TYPE_LABELS[item.type]}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {item.doneDays}/{item.expectedDays}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right tabular-nums",
                                missed > 0 && "font-semibold text-amber-600 dark:text-amber-400",
                              )}
                            >
                              {missed > 0 ? `${missed} gün` : "—"}
                            </TableCell>
                          </StyledTableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </StyledTableContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Günlük döküm</CardTitle>
              <CardDescription>
                Onay bir beyandır — seçilen isim, maddeyi o kişinin yaptığının kanıtı değildir.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StyledTableContainer>
                <Table>
                  <TableHeader>
                    <StyledTableHeaderRow>
                      <StyledTableHead>Gün</StyledTableHead>
                      <StyledTableHead className="text-right">Açılış</StyledTableHead>
                      <StyledTableHead className="text-right">Kapanış</StyledTableHead>
                      <StyledTableHead>Eksik maddeler</StyledTableHead>
                    </StyledTableHeaderRow>
                  </TableHeader>
                  <TableBody>
                    {days.map((day) => (
                      <StyledTableRow key={day.date} className={day.untouched ? "opacity-60" : undefined}>
                        <TableCell className="whitespace-nowrap font-medium">
                          {dayLabel(day.date)}
                        </TableCell>
                        <TableCell className="text-right">
                          <CellValue cell={day.opening} />
                        </TableCell>
                        <TableCell className="text-right">
                          <CellValue cell={day.closing} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {day.untouched
                            ? "hiç onay yok (kapalı olabilir)"
                            : [...day.opening.missing, ...day.closing.missing].join(" · ") || "—"}
                        </TableCell>
                      </StyledTableRow>
                    ))}
                  </TableBody>
                </Table>
              </StyledTableContainer>
            </CardContent>
          </Card>

          {data && data.employees.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Kim onayladı</CardTitle>
                <CardDescription>Aralıktaki toplam onay sayısı.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.employees.map((employee) => (
                  <span
                    key={employee.name}
                    className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium"
                  >
                    {employee.name}
                    <span className="ml-1.5 tabular-nums text-muted-foreground">{employee.count}</span>
                  </span>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function CellValue({ cell }: { cell: Cell }) {
  if (cell.total === 0) return <span className="text-muted-foreground">—</span>
  const complete = cell.done === cell.total
  return (
    <span
      className={cn(
        "tabular-nums",
        complete ? "text-kobipo-green" : "font-semibold text-amber-600 dark:text-amber-400",
      )}
    >
      {cell.done}/{cell.total}
    </span>
  )
}
