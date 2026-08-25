"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExportButton } from "@/components/export/export-button"
import type { ProfitLossResult } from "@/lib/raporlar/kar-zarar"

// Sunucu tipinin KOPYASI değil kendisi: alan eklenip burası güncellenmediğinde
// (ör. satış iadesi satırı) rapor sessizce eksik kalıyordu.
// `import type` derlemede silinir — prisma istemciye sızmaz.
type ProfitLossReport = ProfitLossResult

export default function KarZararPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [report, setReport] = useState<ProfitLossReport | null>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      const now = new Date()
      const startOfYear = new Date(now.getFullYear(), 0, 1)
      setStartDate(startOfYear.toISOString().split("T")[0])
      setEndDate(now.toISOString().split("T")[0])
    }
  }, [companyId])

  useEffect(() => {
    if (companyId && startDate && endDate) {
      fetchReport()
    }
  }, [companyId, startDate, endDate])

  const fetchReport = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        startDate,
        endDate,
      })
      const response = await fetch(`/api/raporlar/kar-zarar?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error("Error fetching report:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kar/Zarar Tablosu</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kar/Zarar Tablosu</CardTitle>
          <CardDescription>Gelir ve gider analizi</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="space-y-2">
              <Label>Başlangıç Tarihi</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Bitiş Tarihi</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={fetchReport} disabled={isLoading}>
                {isLoading ? "Yükleniyor..." : "Raporu Getir"}
              </Button>
              <ExportButton
                dataset="rapor-kar-zarar"
                companyId={companyId}
                size="default"
                params={{ startDate, endDate }}
                disabled={!report}
              />
            </div>
          </div>

          {report && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kalem</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Gelirler</TableCell>
                  <TableCell className="text-right"></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-8">Satış Gelirleri</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.revenue.sales)}</TableCell>
                </TableRow>
                {/* İade satırları yalnız VARSA çizilir: iadesi olmayan firmada
                    her rapora sıfırlı iki satır eklemek gürültüdür. */}
                {report.revenue.returns > 0 && (
                  <TableRow>
                    <TableCell className="pl-8">Satış İadeleri (−)</TableCell>
                    <TableCell className="text-right text-red-600 dark:text-red-400">
                      −{formatCurrency(report.revenue.returns)}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell className="pl-8">Diğer Gelirler</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.revenue.other)}</TableCell>
                </TableRow>
                <TableRow className="bg-muted/50">
                  <TableCell className="font-medium">Toplam Gelir</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(report.revenue.total)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">
                    Satılan Malın Maliyeti
                    {report.purchaseReturns > 0 ? " (alış iadesi düşülmüş)" : ""}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(report.costOfGoodsSold)}</TableCell>
                </TableRow>
                <TableRow className="bg-muted/50">
                  <TableCell className="font-medium">Brüt Kar</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(report.grossProfit)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">İşletme Giderleri</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.operatingExpenses)}</TableCell>
                </TableRow>
                <TableRow className="bg-primary/10">
                  <TableCell className="font-bold text-lg">Net Kar/Zarar</TableCell>
                  <TableCell className={`text-right font-bold text-lg ${report.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrency(report.netProfit)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

