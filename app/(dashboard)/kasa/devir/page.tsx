"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus } from "lucide-react"

interface CashCount {
  id: string
  countDate: string
  expectedBalance: number
  actualBalance: number
  difference: number
  isApproved: boolean
  account: {
    name: string
  }
}

export default function KasaDevirPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [cashCounts, setCashCounts] = useState<CashCount[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchCashCounts()
    }
  }, [companyId])

  const fetchCashCounts = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/kasa/devir?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setCashCounts(data)
      }
    } catch (error) {
      console.error("Error fetching cash counts:", error)
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
          <CardTitle>Kasa Devir İşlemleri</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Kasa Devir İşlemleri</CardTitle>
              <CardDescription>Kasa sayım ve devir kayıtları</CardDescription>
            </div>
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Sayım
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : cashCounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz kasa sayım kaydı bulunmuyor
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Kasa</TableHead>
                  <TableHead className="text-right">Beklenen Bakiye</TableHead>
                  <TableHead className="text-right">Sayılan Bakiye</TableHead>
                  <TableHead className="text-right">Fark</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashCounts.map((count) => (
                  <TableRow key={count.id}>
                    <TableCell>
                      {new Date(count.countDate).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell className="font-medium">{count.account.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(count.expectedBalance)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(count.actualBalance)}</TableCell>
                    <TableCell className={`text-right font-medium ${count.difference >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(count.difference)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={count.isApproved ? "default" : "secondary"}>
                        {count.isApproved ? "Onaylandı" : "Beklemede"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

