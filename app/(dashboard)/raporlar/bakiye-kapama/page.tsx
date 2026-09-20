"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExportButton } from "@/components/export/export-button"
import { CompanyLink } from "@/components/dashboard/company-link"
import { Scale } from "lucide-react"
import type { BakiyeKapamaResult } from "@/lib/raporlar/bakiye-kapama"
import { defaultReportRange } from "@/lib/raporlar/date-range"

// Sunucu tipinin KOPYASI değil kendisi (nakit akışı ekranıyla aynı gerekçe).
// `import type` derlemede silinir — prisma istemciye sızmaz.
type Report = BakiyeKapamaResult

const fmtTRY = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

/**
 * Bakiye kapama / iskonto raporu: kasaya girmeden kapatılan cari tutarlar.
 * Nakit akışında YOKTUR (para hareketi değil); cari bakiyeden düştüğü için
 * "ödeme" satırlarıyla da karışmasın diye ayrı ekrandadır.
 */
export default function BakiyeKapamaRaporuPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [report, setReport] = useState<Report | null>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    const range = defaultReportRange()
    setStartDate(range.startDate)
    setEndDate(range.endDate)
  }, [companyId])

  useEffect(() => {
    if (companyId && startDate && endDate) void fetchReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, startDate, endDate])

  const fetchReport = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId, startDate, endDate })
      const response = await fetch(`/api/raporlar/bakiye-kapama?${params}`)
      if (response.ok) setReport(await response.json())
    } catch (error) {
      console.error("Error fetching write-off report:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Bakiye Kapama / İskonto</h1>
          <p className="text-muted-foreground">
            Kasa hareketi olmadan kapatılan cari tutarlar — nakit akışına girmez.
          </p>
        </div>
        <ExportButton
          dataset="rapor-bakiye-kapama"
          companyId={companyId}
          params={{ startDate, endDate }}
          disabled={!report}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dönem</CardTitle>
          <CardDescription>Kapama tarihine göre süzülür</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Başlangıç</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bitiş</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? "Yükleniyor..." : "Raporu Getir"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Müşterilere verilen iskonto / silinen alacak</p>
                <p className="text-xl font-bold text-rose-600 dark:text-rose-400">{fmtTRY(report.totals.customer)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Tedarikçilerden alınan iskonto / silinen borç</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmtTRY(report.totals.supplier)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Kayıt sayısı</p>
                <p className="text-xl font-bold">{report.totals.count}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Kayıtlar</CardTitle>
              <CardDescription>
                Her satır bir faturanın açık tutarını kapatır; satırı silmek için faturanın ödemeler ekranına gidin.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                  <Scale className="h-8 w-8 text-muted-foreground/50" />
                  Bu dönemde bakiye kapama / iskonto kaydı yok.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tarih</TableHead>
                        <TableHead>Taraf</TableHead>
                        <TableHead>Cari</TableHead>
                        <TableHead>Fatura</TableHead>
                        <TableHead className="text-right">Tutar</TableHead>
                        <TableHead>Açıklama</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {new Date(row.date).toLocaleDateString("tr-TR")}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${
                                row.side === "customer"
                                  ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200"
                              }`}
                            >
                              {row.side === "customer" ? "Verilen iskonto" : "Alınan iskonto"}
                            </span>
                          </TableCell>
                          <TableCell>
                            {row.cariId && row.cariKind ? (
                              <CompanyLink href={`/cari/${row.cariKind}/${row.cariId}`} className="hover:underline">
                                {row.cariName}
                              </CompanyLink>
                            ) : (
                              row.cariName
                            )}
                          </TableCell>
                          <TableCell>
                            <CompanyLink
                              href={`/faturalar/${row.invoiceId}/odemeler`}
                              className="font-mono text-xs hover:underline"
                            >
                              {row.invoiceNo}
                            </CompanyLink>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap tabular-nums font-medium">
                            {fmtTRY(row.amount)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.notes || row.reference || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
