"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts"

interface VATReport {
  period: string
  startDate: string
  endDate: string
  vatByRate: Array<{
    vatRate: number
    netAmount: number
    vatAmount: number
    totalAmount: number
  }>
  totals: {
    netAmount: number
    vatAmount: number
    totalAmount: number
  }
}

interface IncomeExpenseReport {
  period: string
  startDate: string
  endDate: string
  totals: {
    income: number
    expense: number
    profit: number
  }
  chartData: Array<{
    month: string
    income: number
    expense: number
    profit: number
  }>
}

export default function RaporlarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [vatReport, setVatReport] = useState<VATReport | null>(null)
  const [incomeExpenseReport, setIncomeExpenseReport] = useState<IncomeExpenseReport | null>(null)
  const [period, setPeriod] = useState("monthly")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchReports()
    }
  }, [companyId, period, startDate, endDate])

  const fetchReports = async () => {
    if (!companyId) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        period,
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })

      const [vatRes, incomeExpenseRes] = await Promise.all([
        fetch(`/api/raporlar/kdv?${params}`),
        fetch(`/api/raporlar/gelir-gider?${params}`),
      ])

      if (vatRes.ok) {
        const vatData = await vatRes.json()
        setVatReport(vatData)
      }

      if (incomeExpenseRes.ok) {
        const incomeExpenseData = await incomeExpenseRes.json()
        setIncomeExpenseReport(incomeExpenseData)
      }
    } catch (error) {
      console.error("Error fetching reports:", error)
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
      <div>
        <h1 className="text-3xl font-bold">Raporlar</h1>
        <p className="text-muted-foreground">
          KDV raporları ve gelir-gider durumu
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtreler</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="period">Dönem</Label>
              <select
                id="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="monthly">Aylık</option>
                <option value="yearly">Yıllık</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Başlangıç Tarihi</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Bitiş Tarihi</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={fetchReports} disabled={isLoading}>
                {isLoading ? "Yükleniyor..." : "Yenile"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="vat" className="space-y-4">
        <TabsList>
          <TabsTrigger value="vat">KDV Raporu</TabsTrigger>
          <TabsTrigger value="income-expense">Gelir-Gider</TabsTrigger>
        </TabsList>

        <TabsContent value="vat">
          <Card>
            <CardHeader>
              <CardTitle>KDV Raporu</CardTitle>
              <CardDescription>
                {vatReport?.startDate &&
                  `${new Date(vatReport.startDate).toLocaleDateString("tr-TR")} - ${new Date(vatReport.endDate).toLocaleDateString("tr-TR")}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Yükleniyor...</div>
              ) : vatReport ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>KDV Oranı</TableHead>
                        <TableHead className="text-right">Net Tutar</TableHead>
                        <TableHead className="text-right">KDV Tutarı</TableHead>
                        <TableHead className="text-right">Toplam Tutar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vatReport.vatByRate.map((item) => (
                        <TableRow key={item.vatRate}>
                          <TableCell className="font-medium">
                            %{item.vatRate}
                          </TableCell>
                          <TableCell className="text-right">
                            {new Intl.NumberFormat("tr-TR", {
                              style: "currency",
                              currency: "TRY",
                            }).format(item.netAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {new Intl.NumberFormat("tr-TR", {
                              style: "currency",
                              currency: "TRY",
                            }).format(item.vatAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {new Intl.NumberFormat("tr-TR", {
                              style: "currency",
                              currency: "TRY",
                            }).format(item.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold">
                        <TableCell>TOPLAM</TableCell>
                        <TableCell className="text-right">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(vatReport.totals.netAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(vatReport.totals.vatAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(vatReport.totals.totalAmount)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Veri bulunamadı
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="income-expense">
          <Card>
            <CardHeader>
              <CardTitle>Gelir-Gider Durumu</CardTitle>
              <CardDescription>
                {incomeExpenseReport?.startDate &&
                  `${new Date(incomeExpenseReport.startDate).toLocaleDateString("tr-TR")} - ${new Date(incomeExpenseReport.endDate).toLocaleDateString("tr-TR")}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Yükleniyor...</div>
              ) : incomeExpenseReport ? (
                <>
                  <div className="grid gap-4 md:grid-cols-3 mb-6">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Toplam Gelir</CardDescription>
                        <CardTitle className="text-green-600">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(incomeExpenseReport.totals.income)}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Toplam Gider</CardDescription>
                        <CardTitle className="text-red-600">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(incomeExpenseReport.totals.expense)}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardDescription>Kar/Zarar</CardDescription>
                        <CardTitle
                          className={
                            incomeExpenseReport.totals.profit >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }
                        >
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(incomeExpenseReport.totals.profit)}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  </div>

                  {incomeExpenseReport.chartData.length > 0 && (
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={incomeExpenseReport.chartData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="month"
                            tickFormatter={(value) =>
                              new Date(value).toLocaleDateString("tr-TR", {
                                month: "short",
                                year: "numeric",
                              })
                            }
                          />
                          <YAxis
                            tickFormatter={(value) =>
                              new Intl.NumberFormat("tr-TR", {
                                style: "currency",
                                currency: "TRY",
                                notation: "compact",
                              }).format(value)
                            }
                          />
                          <Tooltip
                            formatter={(value: number) =>
                              new Intl.NumberFormat("tr-TR", {
                                style: "currency",
                                currency: "TRY",
                              }).format(value)
                            }
                          />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="income"
                            stroke="#22c55e"
                            name="Gelir"
                            strokeWidth={2}
                          />
                          <Line
                            type="monotone"
                            dataKey="expense"
                            stroke="#ef4444"
                            name="Gider"
                            strokeWidth={2}
                          />
                          <Line
                            type="monotone"
                            dataKey="profit"
                            stroke="#3b82f6"
                            name="Kar/Zarar"
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Veri bulunamadı
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

