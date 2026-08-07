"use client"

/**
 * Aylık Puantaj — vardiya takvimindeki damgaların toplandığı yer.
 *
 * Takvim "kim ne zaman"ı gösterir; burası "ay sonunda ne çıktı"yı: planlanan ve
 * fiilî süre, gecikme, fazla mesai, devamsızlık, izin. Bordroya aktarım da
 * buradan yapılır — puantaj, takvim ile bordro arasındaki tek köprü.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ExportButton } from "@/components/export/export-button"
import { ChevronLeft, ChevronRight, ClipboardList, Loader2, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { money } from "@/lib/format"
import { durationLabel } from "@/lib/personel/vardiya"
import { HOURLY_BASIS_LABEL, laborRatio } from "@/lib/personel/maliyet"
import { BordroAktarDialog } from "@/components/personel/bordro-aktar-dialog"
// Satırın şekli sunucudaki hesapla aynı yerden gelir; ekranın kendi kopyası
// olsaydı uca eklenen bir alan burada sessizce eksik kalırdı.
import type { PuantajRow as Row } from "@/lib/personel/puantaj"

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

export default function PuantajPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [rows, setRows] = useState<Row[]>([])
  const [revenue, setRevenue] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [transfer, setTransfer] = useState<Row | null>(null)

  const periodLabel = `${AYLAR[month - 1]} ${year}`

  const load = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/personel/shifts/ozet?companyId=${companyId}&year=${year}&month=${month}`,
      )
      if (res.ok) {
        const data = await res.json()
        setRows(data.rows)
        setRevenue(data.revenue ?? 0)
      }
    } finally {
      setIsLoading(false)
    }
  }, [companyId, year, month])

  useEffect(() => {
    load()
  }, [load])

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          planned: acc.planned + r.plannedMinutes,
          actual: acc.actual + r.actualMinutes,
          overtime: acc.overtime + r.overtimeMinutes,
          late: acc.late + r.lateMinutes,
          absent: acc.absent + r.absentCount,
          cost: acc.cost + (r.plannedCost ?? 0),
          // Maaşı girilmemiş personel maliyet toplamına giremez; sayısı ayrıca
          // söylenmezse toplam "olduğundan ucuz" okunur.
          missingSalary: acc.missingSalary + (r.grossSalary == null ? 1 : 0),
        }),
        { planned: 0, actual: 0, overtime: 0, late: 0, absent: 0, cost: 0, missingSalary: 0 },
      ),
    [rows],
  )

  const ratio = laborRatio(totals.cost, revenue)

  /**
   * Bordroya yaz: dönemde kayıt varsa prim/kesinti alanları güncellenir, yoksa
   * brüt maaş üzerinden taslak bordro açılır. Bordro ONAYLANMAZ, ödenmez.
   */
  async function applyTransfer(input: { employeeId: string; bonus: number; otherDeduction: number }) {
    if (!companyId || !transfer) return
    setIsSaving(true)
    try {
      const existing = transfer.payroll
      const res = existing
        ? await fetch(`/api/personel/payroll/${existing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bonus: input.bonus, otherDeduction: input.otherDeduction }),
          })
        : await fetch("/api/personel/payroll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              employeeId: input.employeeId,
              periodYear: year,
              periodMonth: month,
              bonus: input.bonus,
              otherDeduction: input.otherDeduction,
              notes: `${periodLabel} puantajından aktarıldı`,
            }),
          })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "Bordroya yazılamadı",
          description: data.error || undefined,
          variant: "destructive",
        })
        return
      }
      toast({
        title: existing ? "Bordro güncellendi" : "Taslak bordro oluşturuldu",
        description: `${transfer.name} · ${periodLabel}`,
      })
      setTransfer(null)
      await load()
    } finally {
      setIsSaving(false)
    }
  }

  if (!companyId) {
    return <p className="p-4 text-muted-foreground">Firma seçili değil.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6 text-muted-foreground" />
            Aylık Puantaj
          </h1>
          <p className="text-sm text-muted-foreground">
            Vardiya takvimindeki damgaların aylık toplamı. Saatler{" "}
            <CompanyLink href="/personel/vardiya" className="underline underline-offset-4">
              Vardiya Takvimi
            </CompanyLink>{" "}
            ekranından gelir.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-semibold">{periodLabel}</span>
          <Button variant="outline" size="icon" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <ExportButton
            dataset="personel-puantaj"
            companyId={companyId}
            params={{ year, month }}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">
          Plan <span className="font-semibold text-foreground">{durationLabel(totals.planned)}</span>
        </span>
        <span className="text-muted-foreground">
          Fiilî <span className="font-semibold text-foreground">{durationLabel(totals.actual)}</span>
        </span>
        {totals.overtime > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">
            Fazla mesai {durationLabel(totals.overtime)}
          </span>
        )}
        {totals.late > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            Gecikme {durationLabel(totals.late)}
          </span>
        )}
        {totals.absent > 0 && (
          <span className="text-red-600 dark:text-red-400">{totals.absent} devamsızlık</span>
        )}
        {totals.cost > 0 && (
          <span
            className="text-muted-foreground"
            title={`Brüt işçilik — ${HOURLY_BASIS_LABEL}. SGK işveren payı dahil değildir.${
              totals.missingSalary > 0
                ? ` ${totals.missingSalary} personelin maaşı girilmediği için toplamda yok.`
                : ""
            }`}
          >
            İşçilik <span className="font-semibold text-foreground">{money(totals.cost)}</span>
            {totals.missingSalary > 0 && (
              <span className="text-amber-600 dark:text-amber-400"> *</span>
            )}
          </span>
        )}
        {ratio != null && (
          <span
            className="text-muted-foreground"
            title={`Dönem net satışı ${money(revenue)}. Kafe/restoranda en çok bakılan gösterge; sektöre göre %25–35 bandı normal kabul edilir.`}
          >
            İşçilik / ciro <span className="font-semibold text-foreground">%{ratio.toFixed(1)}</span>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Puantaj hesaplanıyor...
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          Aktif personel yok.
        </p>
      ) : (
        <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                <StyledTableHead>Personel</StyledTableHead>
                <StyledTableHead className="text-right">Vardiya</StyledTableHead>
                <StyledTableHead className="text-right">Plan</StyledTableHead>
                <StyledTableHead className="text-right">Fiilî</StyledTableHead>
                <StyledTableHead className="text-right">Gecikme</StyledTableHead>
                <StyledTableHead className="text-right">Fazla mesai</StyledTableHead>
                <StyledTableHead className="text-right">Devamsız</StyledTableHead>
                <StyledTableHead className="text-right">İzin</StyledTableHead>
                <StyledTableHead className="text-right">İşçilik</StyledTableHead>
                <StyledTableHead className="text-right">Bordro</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <StyledTableRow key={r.employeeId}>
                  <TableCell>
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {r.name}
                      {/* Dönem içinde ayrılan personel listede KALIR: ayın 20'sinde
                          çıkan kişinin o aya ait çalışması da bordrolanacak. Rozet
                          olmasa satır "hâlâ çalışıyor" gibi okunurdu. */}
                      {r.terminated && (
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
                          title={r.terminationDate ? `Ayrılış: ${r.terminationDate}` : "İşten ayrıldı"}
                        >
                          ayrıldı
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.position || r.department || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {r.shiftCount}
                    {/* Damgalanmamış vardiya sayısı: fiilî sütunun neden eksik
                        göründüğünü açıklar, yoksa "az çalışmış" gibi okunur. */}
                    {r.shiftCount > r.stampedCount && (
                      <span className="ml-1 text-[11px] text-amber-600 dark:text-amber-400">
                        ({r.shiftCount - r.stampedCount} damgasız)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {durationLabel(r.plannedMinutes)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {r.stampedCount > 0 ? durationLabel(r.actualMinutes) : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      r.lateMinutes > 0 && "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {r.lateMinutes > 0 ? `${durationLabel(r.lateMinutes)} (${r.lateCount})` : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      r.overtimeMinutes > 0 && "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {r.overtimeMinutes > 0 ? durationLabel(r.overtimeMinutes) : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      r.absentCount > 0 && "text-red-600 dark:text-red-400",
                    )}
                  >
                    {r.absentCount > 0 ? `${r.absentCount} gün` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {r.leaveDays > 0 ? `${r.leaveDays} gün` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.plannedCost == null ? (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400" title="Brüt maaş girilmemiş">
                        maaş yok
                      </span>
                    ) : (
                      <>
                        <p className="font-semibold">{money(r.plannedCost)}</p>
                        {/* Fiilî maliyet plandan farklıysa yazılır: aynıysa iki kez
                            aynı rakamı basmak sütunu okunmaz hale getiriyor. */}
                        {r.actualCost != null && Math.round(r.actualCost) !== Math.round(r.plannedCost) && (
                          <p className="text-[11px] text-muted-foreground">
                            fiilî {money(r.actualCost)}
                          </p>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTransfer(r)}
                      disabled={r.overtimeMinutes === 0 && r.absentCount === 0}
                      title={
                        r.overtimeMinutes === 0 && r.absentCount === 0
                          ? "Aktarılacak fazla mesai veya devamsızlık yok"
                          : undefined
                      }
                    >
                      <Wallet className="mr-1 h-4 w-4" />
                      {r.payroll ? "Güncelle" : "Aktar"}
                    </Button>
                  </TableCell>
                </StyledTableRow>
              ))}
            </TableBody>
          </Table>
        </StyledTableContainer>
      )}

      <BordroAktarDialog
        row={transfer}
        periodLabel={periodLabel}
        isSaving={isSaving}
        onClose={() => setTransfer(null)}
        onApply={applyTransfer}
      />
    </div>
  )
}
