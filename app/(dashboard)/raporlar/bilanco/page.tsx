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

interface BalanceSheet {
  asOfDate: string
  assets: {
    cashAndBanks: number
    receivables: number
    inventory: number
    total: number
  }
  liabilities: {
    payables: number
    total: number
  }
  equity: number
  total: number
  totalLiabilitiesAndEquity: number
}

export default function BilancoPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [report, setReport] = useState<BalanceSheet | null>(null)
  const [asOfDate, setAsOfDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      // Yerel gün: `toISOString()` UTC'ye kayıyor ve gece 00:00-03:00 arasında
      // bilanço DÜNKÜ tarihe göre çıkıyordu.
      setAsOfDate(toDateInput(new Date()))
    }
  }, [companyId])

  useEffect(() => {
    if (companyId && asOfDate) {
      fetchReport()
    }
  }, [companyId, asOfDate])

  const fetchReport = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        asOfDate,
      })
      const response = await fetch(`/api/raporlar/bilanco?${params}`)
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
          <CardTitle>Bilanço</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bilanço</CardTitle>
          <CardDescription>Varlık ve yükümlülük durumu</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="space-y-2">
              <Label>Tarih</Label>
              <Input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={fetchReport} disabled={isLoading}>
                {isLoading ? "Yükleniyor..." : "Raporu Getir"}
              </Button>
              <ExportButton
                dataset="rapor-bilanco"
                companyId={companyId}
                size="default"
                params={{ asOfDate }}
                disabled={!report}
              />
            </div>
          </div>

          {report && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-bold text-lg mb-4">Aktifler (Varlıklar)</h3>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell>Nakit ve Bankalar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.assets.cashAndBanks)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Alacaklar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.assets.receivables)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Stoklar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.assets.inventory)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-bold">Toplam Aktifler</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.assets.total)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-4">Pasifler (Yükümlülükler + Öz Sermaye)</h3>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell>Borçlar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.liabilities.payables)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-bold">Toplam Yükümlülükler</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.liabilities.total)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Öz Sermaye</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.equity)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-primary/10">
                      <TableCell className="font-bold">Toplam Pasifler</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.totalLiabilitiesAndEquity)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

