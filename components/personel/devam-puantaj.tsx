"use client"

/**
 * Aylık DEVAM özeti — vardiyasız işletmenin puantaj ekranı.
 *
 * `/personel/puantaj` firma vardiyalıysa saat toplamlarını, değilse bu tabloyu
 * çizer. İki ayrı adres yerine tek adres olmasının sebebi bordro: kullanıcı ayın
 * sonunda "puantaj"a gider ve orada kendi çalışma düzenine ait rakamı bulmalıdır.
 *
 * Rakamlar sunucudan gün olarak gelir (lib/personel/devam-ozet.ts); para bu
 * ekranda değil, bordro aktarım penceresinde ve görünür şekilde hesaplanır.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import { ExportButton } from "@/components/export/export-button"
import { CompanyLink } from "@/components/dashboard/company-link"
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { money } from "@/lib/format"
import { dailyRate } from "@/lib/personel/bordro-hesap"
import { deductionDaysFor } from "@/lib/personel/devam"
import type { DevamRow } from "@/lib/personel/devam-ozet"
import { DevamBordroDialog } from "@/components/personel/devam-bordro-dialog"

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

export function DevamPuantaj({
  companyId,
  nested = false,
}: {
  companyId: string
  /** Karma işletmede vardiya puantajının ALTINDA bölüm olarak çizilir: sayfanın
   *  h1'i zaten yukarıda, burada başlık bir alt seviyeye iner. */
  nested?: boolean
}) {
  const { toast } = useToast()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [rows, setRows] = useState<DevamRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [transfer, setTransfer] = useState<DevamRow | null>(null)

  const periodLabel = `${AYLAR[month - 1]} ${year}`

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/personel/attendance/ozet?companyId=${companyId}&year=${year}&month=${month}`,
      )
      if (res.ok) {
        const data = await res.json()
        setRows(data.rows ?? [])
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
          worked: acc.worked + r.workedDays,
          deduction: acc.deduction + r.deductionDays,
          // Maaşı girilmemiş personel maliyet toplamına giremez; sayısı ayrıca
          // söylenmezse toplam "olduğundan ucuz" okunur.
          missingSalary: acc.missingSalary + (r.grossSalary == null ? 1 : 0),
        }),
        { worked: 0, deduction: 0, missingSalary: 0 },
      ),
    [rows],
  )

  /**
   * Bordroya yaz: dönemde kayıt varsa prim/kesinti alanları güncellenir, yoksa
   * brüt maaş üzerinden taslak bordro açılır. Bordro ONAYLANMAZ, ödenmez.
   */
  async function applyTransfer(input: {
    employeeId: string
    bonus: number
    otherDeduction: number
  }) {
    if (!transfer) return
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
              notes: `${periodLabel} devam takviminden aktarıldı`,
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {nested ? (
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              Sabit Mesai — Aylık Devam Özeti
            </h2>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <CalendarDays className="h-6 w-6 text-muted-foreground" />
              Aylık Devam Özeti
            </h1>
          )}
          <p className="text-sm text-muted-foreground">
            Günler{" "}
            <CompanyLink href="/personel/devam" className="underline underline-offset-4">
              Devam Takvimi
            </CompanyLink>{" "}
            ekranından gelir; işaretlenmemiş günler izin kaydı, işletme tatili ve açılış
            saatlerinden türetilir.
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
            dataset="personel-devam"
            companyId={companyId}
            params={{ year, month }}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">
          Çalışılan{" "}
          <span className="font-semibold text-foreground">{gun(totals.worked)}</span>
        </span>
        <span className={cn(totals.deduction > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
          Kesinti {gun(totals.deduction)}
        </span>
        {totals.missingSalary > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {totals.missingSalary} personelin brüt maaşı girilmemiş
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Devam özeti hesaplanıyor...
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          {nested ? "Sabit mesai olarak işaretli personel yok." : "Aktif personel yok."}
        </p>
      ) : (
        <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                <StyledTableHead>Personel</StyledTableHead>
                <StyledTableHead className="text-right">Çalışılan</StyledTableHead>
                <StyledTableHead className="text-right">Ücretli izin</StyledTableHead>
                <StyledTableHead className="text-right">Raporlu</StyledTableHead>
                <StyledTableHead className="text-right">Ücretsiz izin</StyledTableHead>
                <StyledTableHead className="text-right">Devamsız</StyledTableHead>
                <StyledTableHead className="text-right">Kesinti</StyledTableHead>
                <StyledTableHead className="text-right">Bordro</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                // Ekrandaki kesinti, aktarım penceresinin VARSAYILAN seçimiyle aynı
                // hesaptan gelir (raporlu hariç, ücretsiz izin dahil); ayrı yazılsaydı
                // tabloda görünen tutar pencerede başka çıkardı.
                const kesintiGun = deductionDaysFor(r.counts)
                const yevmiye = dailyRate(r.grossSalary)
                return (
                  <StyledTableRow key={r.employeeId}>
                    <TableCell>
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {r.name}
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
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {gun(r.workedDays)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {r.counts.PAID_LEAVE > 0 ? gun(r.counts.PAID_LEAVE) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {r.counts.SICK > 0 ? gun(r.counts.SICK) : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-sm tabular-nums",
                        r.counts.UNPAID_LEAVE > 0 && "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {r.counts.UNPAID_LEAVE > 0 ? gun(r.counts.UNPAID_LEAVE) : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-sm tabular-nums",
                        r.counts.ABSENT > 0 && "text-red-600 dark:text-red-400",
                      )}
                    >
                      {r.counts.ABSENT > 0 ? gun(r.counts.ABSENT) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {kesintiGun === 0 ? (
                        "—"
                      ) : r.grossSalary == null ? (
                        <span
                          className="text-[11px] text-amber-600 dark:text-amber-400"
                          title="Brüt maaş girilmemiş"
                        >
                          {gun(kesintiGun)} · maaş yok
                        </span>
                      ) : (
                        <>
                          <p className="font-semibold text-red-600 dark:text-red-400">
                            −{money(kesintiGun * yevmiye)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{gun(kesintiGun)}</p>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Aktarım BORDRO YAZAR (taslak); özeti okumak serbest. */}
                      <WriteAction>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTransfer(r)}
                          disabled={kesintiGun === 0 && r.payroll == null}
                          title={
                            kesintiGun === 0 && r.payroll == null
                              ? "Aktarılacak kesinti yok"
                              : undefined
                          }
                        >
                          <Wallet className="mr-1 h-4 w-4" />
                          {r.payroll ? "Güncelle" : "Aktar"}
                        </Button>
                      </WriteAction>
                    </TableCell>
                  </StyledTableRow>
                )
              })}
            </TableBody>
          </Table>
        </StyledTableContainer>
      )}

      <DevamBordroDialog
        row={transfer}
        periodLabel={periodLabel}
        isSaving={isSaving}
        onClose={() => setTransfer(null)}
        onApply={applyTransfer}
      />
    </div>
  )
}

const gun = (n: number) =>
  `${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün`
