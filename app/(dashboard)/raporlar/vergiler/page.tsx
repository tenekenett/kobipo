"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface VATDeclaration {
  period: string
  year: number
  month?: number
  calculatedVAT: number
  deductibleVAT: number
  netVAT: number
  breakdown: {
    sales: Array<{ vatRate: number; vatAmount: number; totalAmount: number }>
    purchases: Array<{ vatRate: number; vatAmount: number; totalAmount: number }>
  }
}

interface WithholdingTax {
  period: { year: number; month: number }
  totalWithholding: number
  totalPayments: number
  payments: Array<{
    id: string
    date: string
    amount: number
    description: string | null
    supplier: { name: string; taxNumber: string | null } | null
  }>
}

interface BaBsForm {
  period: { year: number; month: number }
  sales: {
    count: number
    netAmount: number
    vatAmount: number
    totalAmount: number
  }
  purchases: {
    count: number
    netAmount: number
    vatAmount: number
    totalAmount: number
  }
}

export default function VergilerPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [vatDeclaration, setVatDeclaration] = useState<VATDeclaration | null>(null)
  const [withholdingTax, setWithholdingTax] = useState<WithholdingTax | null>(null)
  const [baBsForm, setBaBsForm] = useState<BaBsForm | null>(null)
  const [year, setYear] = useState(new Date().getFullYear().toString())
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString())
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchReports()
    }
  }, [companyId, year, month])

  const fetchReports = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId, year, month })
      
      const [vatRes, muhtasarRes, baBsRes] = await Promise.all([
        fetch(`/api/raporlar/kdv-beyanname?${params}&period=monthly`),
        fetch(`/api/raporlar/muhtasar?${params}`),
        fetch(`/api/raporlar/ba-bs?${params}`),
      ])

      if (vatRes.ok) {
        const data = await vatRes.json()
        setVatDeclaration(data)
      }
      if (muhtasarRes.ok) {
        const data = await muhtasarRes.json()
        setWithholdingTax(data)
      }
      if (baBsRes.ok) {
        const data = await baBsRes.json()
        setBaBsForm(data)
      }
    } catch (error) {
      console.error("Error fetching reports:", error)
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
          <CardTitle>Vergi Beyannameleri</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Vergi Beyannameleri</CardTitle>
          <CardDescription>KDV, Muhtasar ve Ba-Bs formu hazırlık raporları</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="space-y-2">
              <Label>Yıl</Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                min="2020"
                max="2099"
              />
            </div>
            <div className="space-y-2">
              <Label>Ay</Label>
              <Input
                type="number"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                min="1"
                max="12"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={fetchReports} disabled={isLoading}>
                {isLoading ? "Yükleniyor..." : "Raporları Getir"}
              </Button>
            </div>
          </div>

          <Tabs defaultValue="kdv" className="space-y-4">
            <TabsList>
              <TabsTrigger value="kdv">KDV Beyanname</TabsTrigger>
              <TabsTrigger value="muhtasar">Muhtasar Beyanname</TabsTrigger>
              <TabsTrigger value="ba-bs">Ba-Bs Formu</TabsTrigger>
            </TabsList>

            <TabsContent value="kdv">
              {vatDeclaration && (
                <Card>
                  <CardHeader>
                    <CardTitle>KDV Beyanname Hazırlık Raporu</CardTitle>
                    <CardDescription>
                      {vatDeclaration.year} Yılı {vatDeclaration.month}. Ay
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Kalem</TableHead>
                          <TableHead className="text-right">Tutar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">Hesaplanan KDV (Satışlar)</TableCell>
                          <TableCell className="text-right">{formatCurrency(vatDeclaration.calculatedVAT)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">İndirilecek KDV (Alışlar)</TableCell>
                          <TableCell className="text-right">{formatCurrency(vatDeclaration.deductibleVAT)}</TableCell>
                        </TableRow>
                        <TableRow className="bg-primary/10">
                          <TableCell className="font-bold text-lg">Ödenecek KDV</TableCell>
                          <TableCell className="text-right font-bold text-lg">
                            {formatCurrency(vatDeclaration.netVAT)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="muhtasar">
              {withholdingTax && (
                <Card>
                  <CardHeader>
                    <CardTitle>Muhtasar Beyanname Hazırlık Raporu</CardTitle>
                    <CardDescription>
                      {withholdingTax.period.year} Yılı {withholdingTax.period.month}. Ay
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <Card>
                          <CardHeader className="pb-2">
                            <CardDescription>Toplam Ödemeler</CardDescription>
                            <CardTitle>{formatCurrency(withholdingTax.totalPayments)}</CardTitle>
                          </CardHeader>
                        </Card>
                        <Card>
                          <CardHeader className="pb-2">
                            <CardDescription>Toplam Stopaj</CardDescription>
                            <CardTitle>{formatCurrency(withholdingTax.totalWithholding)}</CardTitle>
                          </CardHeader>
                        </Card>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tarih</TableHead>
                            <TableHead>Alıcı</TableHead>
                            <TableHead className="text-right">Tutar</TableHead>
                            <TableHead className="text-right">Stopaj</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {withholdingTax.payments.map((payment) => (
                            <TableRow key={payment.id}>
                              <TableCell>{new Date(payment.date).toLocaleDateString("tr-TR")}</TableCell>
                              <TableCell>{payment.supplier?.name || "-"}</TableCell>
                              <TableCell className="text-right">{formatCurrency(payment.amount)}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(payment.amount * 0.15)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="ba-bs">
              {baBsForm && (
                <Card>
                  <CardHeader>
                    <CardTitle>Ba-Bs Formu Hazırlık Raporu</CardTitle>
                    <CardDescription>
                      {baBsForm.period.year} Yılı {baBsForm.period.month}. Ay
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <h3 className="font-bold text-lg mb-4">Satışlar</h3>
                        <Table>
                          <TableBody>
                            <TableRow>
                              <TableCell>Fatura Sayısı</TableCell>
                              <TableCell className="text-right">{baBsForm.sales.count}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>Net Tutar</TableCell>
                              <TableCell className="text-right">{formatCurrency(baBsForm.sales.netAmount)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>KDV</TableCell>
                              <TableCell className="text-right">{formatCurrency(baBsForm.sales.vatAmount)}</TableCell>
                            </TableRow>
                            <TableRow className="bg-muted/50">
                              <TableCell className="font-bold">Toplam</TableCell>
                              <TableCell className="text-right font-bold">
                                {formatCurrency(baBsForm.sales.totalAmount)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                      <div>
                        <h3 className="font-bold text-lg mb-4">Alışlar</h3>
                        <Table>
                          <TableBody>
                            <TableRow>
                              <TableCell>Fatura Sayısı</TableCell>
                              <TableCell className="text-right">{baBsForm.purchases.count}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>Net Tutar</TableCell>
                              <TableCell className="text-right">{formatCurrency(baBsForm.purchases.netAmount)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>KDV</TableCell>
                              <TableCell className="text-right">{formatCurrency(baBsForm.purchases.vatAmount)}</TableCell>
                            </TableRow>
                            <TableRow className="bg-muted/50">
                              <TableCell className="font-bold">Toplam</TableCell>
                              <TableCell className="text-right font-bold">
                                {formatCurrency(baBsForm.purchases.totalAmount)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

