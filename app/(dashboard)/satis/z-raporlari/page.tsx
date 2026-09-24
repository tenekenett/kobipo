"use client"

// Z raporları — yazarkasa Z'si + Kobipo fişleriyle karşılaştırma.
// Plan: docs/okc/ASAMA1-KOBIPO.md A3. Kural: lib/okc/z-mutabakat.ts
//
// Kasiyer Z girer; düzeltme ve silme yönetici/şube müdürü/muhasebecidedir
// (uç `canEdit` döndürür, lib/okc/access.ts).

import { WriteAction } from "@/components/dashboard/write-guard"
import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FileCheck, Plus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHead,
  StyledTableHeaderRow,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ZReportFormDialog, type ZReportEditable } from "@/components/okc/z-report-form"
import { ZReportDetailDialog } from "@/components/okc/z-report-detail"
import { cn } from "@/lib/utils"
import type { OkcDeviceView } from "@/lib/okc/devices"

type ZRow = {
  id: string
  device: { id: string; name: string; serialNo: string }
  zNo: number
  takenAt: string
  ekuNo: string | null
  grossTotal: number
  receiptCount: number | null
  source: string
  kobipoTotal: number
  kobipoReceiptCount: number
  totalDiff: number | null
  ok: boolean
  comparable: boolean
  internalIssueCount: number
  firstWindow: boolean
}

const money = (value: number) =>
  `${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`

const ALL = "__all__"

/** `<input type="date">` değeri, yerel gün. */
function dayInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function StatusBadge({ row }: { row: ZRow }) {
  if (!row.comparable) return <Badge variant="bekliyor">Cihaz ayrılamadı</Badge>
  if (row.ok) return <Badge variant="odendi">Tutuyor</Badge>
  return <Badge variant="gecikti">Fark var</Badge>
}

export default function ZRaporlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [devices, setDevices] = useState<OkcDeviceView[]>([])
  // Liste gelmeden "cihaz yok" boş durumu basılmasın.
  const [devicesLoaded, setDevicesLoaded] = useState(false)
  const [rows, setRows] = useState<ZRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [deviceFilter, setDeviceFilter] = useState(ALL)
  const [from, setFrom] = useState(() => dayInput(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo] = useState(() => dayInput(new Date()))

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ZReportEditable | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const fetchDevices = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/okc/devices?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
    if (res.ok) setDevices(await res.json())
    setDevicesLoaded(true)
  }, [companyId])

  const fetchReports = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId })
      // Gün sınırları yerel saatle: "bitiş" günün sonuna kadar.
      params.set("from", new Date(`${from}T00:00:00`).toISOString())
      params.set("to", new Date(`${to}T23:59:59`).toISOString())
      if (deviceFilter !== ALL) params.set("deviceId", deviceFilter)
      const res = await fetch(`/api/okc/z-raporlari?${params}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Z raporları alınamadı")
      setRows(data.reports ?? [])
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [companyId, from, to, deviceFilter, toast])

  useEffect(() => {
    fetchDevices()
  }, [fetchDevices])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Z Raporları</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const activeDevices = devices.filter((d) => d.isActive)
  const diffCount = rows.filter((r) => r.comparable && !r.ok).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Z Raporları</h1>
          <p className="text-sm text-muted-foreground">
            Gün sonunda yazarkasadan aldığınız Z raporunu girin; Kobipo aynı aralıktaki fişlerle karşılaştırır.
          </p>
        </div>
        {activeDevices.length > 0 && (
          <WriteAction>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Z raporu gir
            </Button>
          </WriteAction>
        )}
      </div>

      {!devicesLoaded ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</CardContent>
        </Card>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <FileCheck className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Önce yazarkasanızı tanımlayın</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Z raporu bir cihaza aittir. Cihazı{" "}
              <CompanyLink href="/ayarlar/yazarkasa" className="font-medium text-primary underline-offset-4 hover:underline">
                Ayarlar → Yazarkasa
              </CompanyLink>{" "}
              ekranından seri numarasıyla ekleyin.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle>Girilen Z raporları</CardTitle>
              <CardDescription>
                {rows.length} Z raporu{diffCount > 0 ? ` · ${diffCount} tanesinde fark var` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {devices.length > 1 && (
                <div className="grid gap-1">
                  <Label className="text-xs">Yazarkasa</Label>
                  <Select value={deviceFilter} onValueChange={setDeviceFilter}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Tümü</SelectItem>
                      {devices.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="z-from">
                  Başlangıç
                </Label>
                <Input id="z-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs" htmlFor="z-to">
                  Bitiş
                </Label>
                <Input id="z-to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Bu aralıkta girilmiş Z raporu yok.</p>
            ) : (
              <StyledTableContainer>
                <Table>
                  <TableHeader>
                    <StyledTableHeaderRow>
                      <StyledTableHead>Tarih</StyledTableHead>
                      <StyledTableHead>Yazarkasa</StyledTableHead>
                      <StyledTableHead className="text-right">Z no</StyledTableHead>
                      <StyledTableHead className="text-right">Z toplamı</StyledTableHead>
                      <StyledTableHead className="text-right">Kobipo</StyledTableHead>
                      <StyledTableHead className="text-right">Fark</StyledTableHead>
                      <StyledTableHead>Durum</StyledTableHead>
                    </StyledTableHeaderRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <StyledTableRow
                        key={row.id}
                        className="cursor-pointer"
                        onClick={() => setDetailId(row.id)}
                      >
                        <TableCell className="whitespace-nowrap">
                          {new Date(row.takenAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell>{row.device.name}</TableCell>
                        <TableCell className="text-right font-mono">{row.zNo}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(row.grossTotal)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(row.kobipoTotal)}</TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono tabular-nums",
                            row.totalDiff && row.comparable ? "font-semibold text-red-700 dark:text-red-300" : "",
                          )}
                        >
                          {row.totalDiff ? `${row.totalDiff > 0 ? "+" : ""}${money(row.totalDiff)}` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge row={row} />
                            {row.internalIssueCount > 0 && <Badge variant="bekliyor">Z kendi içinde tutarsız</Badge>}
                          </div>
                        </TableCell>
                      </StyledTableRow>
                    ))}
                  </TableBody>
                </Table>
              </StyledTableContainer>
            )}
          </CardContent>
        </Card>
      )}

      <ZReportFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        devices={devices}
        existing={editing}
        onSaved={(id) => {
          fetchReports()
          fetchDevices()
          setDetailId(id)
        }}
      />

      <ZReportDetailDialog
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
        companyId={companyId}
        reportId={detailId}
        onEdit={(detail) => {
          setDetailId(null)
          setEditing(detail)
          setFormOpen(true)
        }}
        onDeleted={() => {
          fetchReports()
          fetchDevices()
        }}
      />
    </div>
  )
}
