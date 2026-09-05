"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExportButton } from "@/components/export/export-button"
import { NakitProjeksiyonPanel } from "@/components/raporlar/nakit-projeksiyon-panel"
import type { CashFlowResult } from "@/lib/raporlar/nakit-akisi"
import { toDateInput } from "@/lib/format"

// Sunucu tipinin KOPYASI değil kendisi (kâr/zarar ekranıyla aynı gerekçe): alan
// eklenip burası güncellenmediğinde rapor sessizce eksik kalıyordu.
// `import type` derlemede silinir — prisma istemciye sızmaz.
type CashFlowReport = CashFlowResult

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
      {/* İki yön, iki sekme: tablo GEÇMİŞE bakar ("dönemde ne girdi/çıktı"),
          projeksiyon GELECEĞE ("önümüzdeki çeyrekte param bitiyor mu"). */}
      <Tabs defaultValue="tablo" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tablo">Nakit Akış Tablosu</TabsTrigger>
          <TabsTrigger value="projeksiyon">Projeksiyon</TabsTrigger>
        </TabsList>

        <TabsContent value="tablo">
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
                      <TableCell className="pl-8">Faturalardan Tahsilat</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.operatingActivities.collections)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Faturalara Ödeme</TableCell>
                      <TableCell className="text-right">({formatCurrency(report.operatingActivities.payments)})</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Diğer Gelirler (faturasız)</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.operatingActivities.otherIncome)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-8">Diğer Giderler (faturasız)</TableCell>
                      <TableCell className="text-right">({formatCurrency(report.operatingActivities.otherExpense)})</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-medium">İşletme Faaliyetlerinden Net Nakit Akışı</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.operatingActivities.net)}</TableCell>
                    </TableRow>
                    {/* Denge kalemi yalnız SIFIR DEĞİLSE çizilir: hareketleri eksiksiz
                        kayıtlı firmada her rapora "0,00" bir satır eklemek gürültüdür. */}
                    {Math.abs(report.unclassified) >= 0.01 && (
                      <TableRow>
                        <TableCell className="pl-8">
                          Sınıflandırılmamış hareketler
                          <span className="block text-xs text-muted-foreground">
                            Dönem içinde açılan hesabın devri, elle bakiye düzeltmesi vb.
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(report.unclassified)}</TableCell>
                      </TableRow>
                    )}
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
        </TabsContent>

        <TabsContent value="projeksiyon">
          <NakitProjeksiyonPanel companyId={companyId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

