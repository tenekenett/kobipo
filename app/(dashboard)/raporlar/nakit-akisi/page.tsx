"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExportButton } from "@/components/export/export-button"
import { toDateInput } from "@/lib/format"

interface CashFlowReport {
  period: {
    startDate: string
    endDate: string
  }
  beginningBalance: number
  operatingActivities: {
    collections: number
    payments: number
    otherIncome: number
    otherExpense: number
    net: number
  }
  investingActivities: {
    net: number
  }
  financingActivities: {
    net: number
  }
  netCashFlow: number
  endingBalance: number
}

export default function NakitAkisiPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [report, setReport] = useState<CashFlowReport | null>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      const now = new Date()
      // Nakit akışı da kümülatif okunur: yılbaşı → bugün. Gün yerel yazılır,
      // `toISOString()` UTC'ye kayıp 1 Ocak'ı "31.12.2025" gösteriyordu.
      setStartDate(toDateInput(new Date(now.getFullYear(), 0, 1)))
      setEndDate(toDateInput(now))
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
      const response = await fetch(`/api/raporlar/nakit-akisi?${params}`)
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
          <CardTitle>Nakit Akış Tablosu</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Nakit Akış Tablosu</CardTitle>
          <CardDescription>Nakit giriş ve çıkış analizi</CardDescription>
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
                dataset="rapor-nakit-akisi"
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
                  <TableCell className="font-medium">Başlangıç Nakit Bakiyesi</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.beginningBalance)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">İşletme Faaliyetlerinden Nakit Akışı</TableCell>
                  <TableCell className="text-right"></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-8">Müşterilerden Tahsilatlar</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.operatingActivities.collections)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-8">Tedarikçilere Ödemeler</TableCell>
                  <TableCell className="text-right">({formatCurrency(report.operatingActivities.payments)})</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-8">Diğer Gelirler</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.operatingActivities.otherIncome)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-8">Diğer Giderler</TableCell>
                  <TableCell className="text-right">({formatCurrency(report.operatingActivities.otherExpense)})</TableCell>
                </TableRow>
                <TableRow className="bg-muted/50">
                  <TableCell className="font-medium">İşletme Faaliyetlerinden Net Nakit Akışı</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(report.operatingActivities.net)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Yatırım Faaliyetlerinden Nakit Akışı</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.investingActivities.net)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Finansman Faaliyetlerinden Nakit Akışı</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.financingActivities.net)}</TableCell>
                </TableRow>
                <TableRow className="bg-muted/50">
                  <TableCell className="font-medium">Dönem İçi Net Nakit Akışı</TableCell>
                  <TableCell className="text-right font-bold">{formatCurrency(report.netCashFlow)}</TableCell>
                </TableRow>
                <TableRow className="bg-primary/10">
                  <TableCell className="font-bold text-lg">Bitiş Nakit Bakiyesi</TableCell>
                  <TableCell className="text-right font-bold text-lg">{formatCurrency(report.endingBalance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

