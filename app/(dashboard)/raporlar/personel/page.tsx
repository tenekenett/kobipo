"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { RefreshCcw, Users, Wallet, CalendarCheck, ClipboardList, TrendingDown } from "lucide-react"
import { ExportButton } from "@/components/export/export-button"
import { CompanyLink } from "@/components/dashboard/company-link"
import { durationLabel } from "@/lib/personel/vardiya"

type Report = {
  year: number
  headcount: { total: number; active: number; onLeave: number; terminated: number }
  cost: { payrollCount: number; totalGross: number; totalNet: number; totalDeductions: number; employerCostEstimate: number }
  leaveUsage: { byType: Record<string, number>; total: number }
  turnover: { terminatedThisYear: number; rate: number }
  byDepartment: Array<{ department: string; headcount: number; gross: number; net: number }>
}

const LEAVE_LABELS: Record<string, string> = { ANNUAL: "Yıllık", EXCUSE: "Mazeret", SICK: "Hastalık", UNPAID: "Ücretsiz" }

/** Bu ayın puantaj toplamı — ayrıntısı /personel/puantaj'da. */
type PuantajOzet = { planned: number; actual: number; late: number; overtime: number; absent: number }
const fmt = (n: number) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PersonelRaporlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [data, setData] = useState<Report | null>(null)
  const [puantaj, setPuantaj] = useState<PuantajOzet | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchReport = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/raporlar/personel?companyId=${companyId}&year=${year}`)
      if (res.ok) setData(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId, year])

  // Puantaj AY bazlıdır, bu sayfanın geri kalanı YIL bazlı: bu yüzden ayrı çekilir
  // ve kart kendi döneminin adını taşır — iki ölçü aynı başlığın altında karışmasın.
  const fetchPuantaj = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(
      `/api/personel/shifts/ozet?companyId=${companyId}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    )
    if (!res.ok) return
    const { rows } = (await res.json()) as {
      rows: Array<{
        plannedMinutes: number
        actualMinutes: number
        lateMinutes: number
        overtimeMinutes: number
        absentCount: number
      }>
    }
    setPuantaj(
      rows.reduce(
        (acc, r) => ({
          planned: acc.planned + r.plannedMinutes,
          actual: acc.actual + r.actualMinutes,
          late: acc.late + r.lateMinutes,
          overtime: acc.overtime + r.overtimeMinutes,
          absent: acc.absent + r.absentCount,
        }),
        { planned: 0, actual: 0, late: 0, overtime: 0, absent: 0 },
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  useEffect(() => { fetchReport() }, [fetchReport])
  useEffect(() => { fetchPuantaj() }, [fetchPuantaj])

  if (!companyId) return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Personel Raporları</h1>
          <p className="text-sm text-muted-foreground">Maliyet, izin kullanımı, headcount ve devir oranı</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <ExportButton dataset="rapor-personel" companyId={companyId} params={{ year }} disabled={!data} />
          <Button variant="outline" size="sm" onClick={fetchReport}><RefreshCcw className="mr-1 h-4 w-4" /> Yenile</Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}

      {data && (
        <>
          {/* Headcount */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue"><Users className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Toplam Personel</p><p className="text-xl font-bold">{data.headcount.total}</p></div></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Aktif</p><p className="text-xl font-bold text-emerald-600">{data.headcount.active}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">İzinde</p><p className="text-xl font-bold text-amber-600">{data.headcount.onLeave}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ayrılan</p><p className="text-xl font-bold text-muted-foreground">{data.headcount.terminated}</p></CardContent></Card>
          </div>

          {/* Maliyet + Devir */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-5 w-5" /> Personel Maliyeti ({data.year})</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Bordro sayısı</span><span className="font-medium">{data.cost.payrollCount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Toplam Brüt (+ek ödeme)</span><span className="font-medium">{fmt(data.cost.totalGross)} ₺</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Toplam Net (ödenen)</span><span className="font-medium">{fmt(data.cost.totalNet)} ₺</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Toplam Kesinti</span><span className="font-medium text-destructive">{fmt(data.cost.totalDeductions)} ₺</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-semibold">Tahmini İşveren Maliyeti</span><span className="font-bold">{fmt(data.cost.employerCostEstimate)} ₺</span></div>
                <p className="text-[11px] text-muted-foreground">* İşveren maliyeti, brüt üzerinden ~%22.5 işveren payı varsayımıyla tahminidir.</p>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="h-5 w-5" /> Devir Oranı</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-bold">%{data.turnover.rate}</span>
                    <span className="mb-1 text-xs text-muted-foreground">({data.turnover.terminatedThisYear} ayrılan / {data.year})</span>
                  </div>
                </CardContent>
              </Card>
              {puantaj && puantaj.planned > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ClipboardList className="h-5 w-5" /> Puantaj (bu ay)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Planlanan</span>
                      <span className="font-medium">{durationLabel(puantaj.planned)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fiilî</span>
                      <span className="font-medium">
                        {puantaj.actual > 0 ? durationLabel(puantaj.actual) : "—"}
                      </span>
                    </div>
                    {puantaj.overtime > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fazla mesai</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {durationLabel(puantaj.overtime)}
                        </span>
                      </div>
                    )}
                    {puantaj.late > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Gecikme</span>
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          {durationLabel(puantaj.late)}
                        </span>
                      </div>
                    )}
                    {puantaj.absent > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Devamsızlık</span>
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {puantaj.absent} gün
                        </span>
                      </div>
                    )}
                    <CompanyLink
                      href="/personel/puantaj"
                      className="block border-t pt-2 text-xs underline-offset-4 hover:underline"
                    >
                      Personel kırılımı →
                    </CompanyLink>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-5 w-5" /> İzin Kullanımı ({data.year})</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {Object.entries(data.leaveUsage.byType).map(([type, days]) => (
                    <div key={type} className="flex justify-between">
                      <span className="text-muted-foreground">{LEAVE_LABELS[type] || type}</span>
                      <span className="font-medium">{days} gün</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-2"><span className="font-semibold">Toplam</span><span className="font-bold">{data.leaveUsage.total} gün</span></div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Departman kırılımı */}
          <Card>
            <CardHeader><CardTitle className="text-base">Departman Kırılımı (Bordro Özeti)</CardTitle></CardHeader>
            <CardContent>
              {data.byDepartment.length === 0 ? (
                <div className="text-sm text-muted-foreground">Veri yok.</div>
              ) : (
                <StyledTableContainer>
                  <Table>
                    <TableHeader>
                      <StyledTableHeaderRow>
                        <StyledTableHead>Departman</StyledTableHead>
                        <StyledTableHead className="text-center">Personel</StyledTableHead>
                        <StyledTableHead className="text-right">Toplam Brüt</StyledTableHead>
                        <StyledTableHead className="text-right">Toplam Net</StyledTableHead>
                      </StyledTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                      {data.byDepartment.map((d, idx) => (
                        <StyledTableRow key={d.department} index={idx}>
                          <TableCell className="font-medium">{d.department}</TableCell>
                          <TableCell className="text-center">{d.headcount}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{fmt(d.gross)} ₺</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{fmt(d.net)} ₺</TableCell>
                        </StyledTableRow>
                      ))}
                    </TableBody>
                  </Table>
                </StyledTableContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
