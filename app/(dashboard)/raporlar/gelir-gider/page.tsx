"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExportButton } from "@/components/export/export-button"
import { CariLink } from "@/components/raporlar/rapor-link"
import type { BreakdownRow } from "@/lib/raporlar/gelir-gider-kirilim"
import type { IncomeExpenseResult } from "@/lib/raporlar/gelir-gider"
import { toDateInput } from "@/lib/format"

const money = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value)

type AxisKey = "kategori" | "etiket" | "cari" | "ay"

const AXES: Array<{ key: AxisKey; label: string; note?: string }> = [
  { key: "kategori", label: "Kategori" },
  {
    key: "etiket",
    label: "Etiket",
    // Uyarı ZORUNLU: bir belge birden çok etikete girer, dolayısıyla satırların
    // toplamı genel toplamı aşabilir. Yazılmazsa "toplamlar tutmuyor" denir.
    note: "Bir belge birden çok etikete girebilir — satır toplamı genel toplamı aşabilir.",
  },
  { key: "cari", label: "Cari" },
  { key: "ay", label: "Aylık" },
]

/**
 * Kırılım tablosu. Satır adı carilerde KARTA bağlanır (`ref` + `kind`);
 * kategori/etiket/ay satırlarının gideceği bir kart yoktur, düz metin kalır.
 */
function BreakdownTable({
  rows,
  companyId,
  emptyText,
}: {
  rows: BreakdownRow[]
  companyId: string
  emptyText: string
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
  }

  // Pay çubuğunun ölçeği: en büyük mutlak hacim. Sıfırsa çubuk çizilmez
  // (bölme yok) — tüm satırları %100 dolu göstermek yanlış okunurdu.
  const scale = Math.max(...rows.map((row) => Math.abs(row.revenue) + Math.abs(row.expense)), 0)

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kalem</TableHead>
            <TableHead className="text-right">Gelir</TableHead>
            <TableHead className="text-right">Gider</TableHead>
            <TableHead className="text-right">Kâr</TableHead>
            <TableHead className="text-right">Belge</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const volume = Math.abs(row.revenue) + Math.abs(row.expense)
            const share = scale > 0 ? (volume / scale) * 100 : 0
            return (
              <TableRow key={`${row.key}-${row.label}`}>
                <TableCell>
                  {/* Cari satırında ad karta bağlanır; `CariLink` yönü (müşteri /
                      tedarikçi) ve `?company=` taşımasını kendi hallediyor, hedef
                      sayfa kapalıysa da linki basmıyor. */}
                  {row.ref && row.kind ? (
                    <CariLink
                      kind={row.kind}
                      cariRef={row.ref}
                      companyId={companyId}
                      from="/raporlar/gelir-gider"
                      className="font-medium"
                    >
                      {row.label}
                    </CariLink>
                  ) : (
                    <span className="font-medium">{row.label}</span>
                  )}
                  <span
                    className="mt-1 block h-1 rounded-full bg-kobipo-blue/30"
                    style={{ width: `${Math.max(share, 2)}%` }}
                    aria-hidden
                  />
                </TableCell>
                <TableCell className="text-right">{money(row.revenue)}</TableCell>
                <TableCell className="text-right">{money(row.expense)}</TableCell>
                <TableCell
                  className={`text-right font-medium ${
                    row.profit >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {money(row.profit)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{row.count}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export default function GelirGiderPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [report, setReport] = useState<IncomeExpenseResult | null>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    // Kârlılık YILBAŞINDAN BUGÜNE açılır (kâr/zarar ekranıyla aynı varsayılan);
    // gün `toDateInput` ile yazılır, `toISOString()` UTC'ye kayıyor.
    const now = new Date()
    setStartDate(toDateInput(new Date(now.getFullYear(), 0, 1)))
    setEndDate(toDateInput(now))
  }, [companyId])

  const fetchReport = useCallback(async () => {
    if (!companyId || !startDate || !endDate) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId, startDate, endDate })
      const response = await fetch(`/api/raporlar/gelir-gider?${params}`)
      if (response.ok) setReport(await response.json())
    } catch (error) {
      console.error("Gelir-gider raporu alınamadı:", error)
    } finally {
      setIsLoading(false)
    }
  }, [companyId, startDate, endDate])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Gelir-Gider (Karlılık)</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const rowsFor = (axis: AxisKey): BreakdownRow[] => {
    if (!report) return []
    if (axis === "kategori") return report.byCategory
    if (axis === "etiket") return report.byTag
    if (axis === "cari") return report.byParty
    return report.byMonth
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Gelir-Gider (Karlılık)</CardTitle>
          <CardDescription>
            Dönem kârlılığının kategori, etiket, cari ve ay kırılımı. Tutarlar KDV hariçtir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>Başlangıç Tarihi</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bitiş Tarihi</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={fetchReport} disabled={isLoading}>
                {isLoading ? "Yükleniyor..." : "Raporu Getir"}
              </Button>
              <ExportButton
                dataset="rapor-gelir-gider"
                companyId={companyId}
                size="default"
                params={{ startDate, endDate }}
                disabled={!report}
              />
            </div>
          </div>

          {report && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Gelir</p>
                  <p className="text-2xl font-bold">{money(report.totals.revenue)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Gider</p>
                  <p className="text-2xl font-bold">{money(report.totals.expense)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Kâr / Zarar</p>
                  <p
                    className={`text-2xl font-bold ${
                      report.totals.profit >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {money(report.totals.profit)}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Kâr Marjı</p>
                  {/* Ciro sıfırken oran YOKTUR: "%0 marj" yazmak yerine susulur. */}
                  <p className="text-2xl font-bold">
                    {report.totals.marginPct === null
                      ? "—"
                      : `%${report.totals.marginPct.toFixed(1)}`}
                  </p>
                </div>
              </div>

              {report.uncategorized.count > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-amber-900 dark:text-amber-200">
                    <strong>{report.uncategorized.count}</strong> kayıtta kategori yok; bunlar
                    &quot;Kategorisiz&quot; ve &quot;Faturasız işlemler&quot; satırlarında
                    toplandı. Kırılımın işe yaraması için fatura ve kasa hareketlerine kategori
                    girilmesi gerekir.
                  </p>
                </div>
              )}

              <Tabs defaultValue="kategori">
                <TabsList>
                  {AXES.map((axis) => (
                    <TabsTrigger key={axis.key} value={axis.key}>
                      {axis.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {AXES.map((axis) => (
                  <TabsContent key={axis.key} value={axis.key} className="space-y-2">
                    {axis.note && (
                      <p className="text-xs text-muted-foreground">{axis.note}</p>
                    )}
                    <BreakdownTable
                      rows={rowsFor(axis.key)}
                      companyId={companyId}
                      emptyText={
                        axis.key === "cari"
                          ? "Bu dönemde cariye bağlı belge yok."
                          : "Bu dönemde kayıt yok."
                      }
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
