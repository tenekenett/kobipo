"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

interface AccountSummary {
  accountCode: string
  accountName: string
  debitTotal: number
  creditTotal: number
  balance: number
}

export default function KebirPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [summary, setSummary] = useState<AccountSummary[]>([])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  useEffect(() => {
    if (companyId) {
      fetchSummary()
    }
  }, [companyId, startDate, endDate])

  const fetchSummary = async () => {
    if (!companyId) return
    try {
      const params = new URLSearchParams({ companyId })
      if (startDate) params.append("startDate", startDate)
      if (endDate) params.append("endDate", endDate)

      const response = await fetch(`/api/muhasebe/kebir?${params}`)
      if (response.ok) {
        const data = await response.json()
        setSummary(data)
      }
    } catch (error) {
      console.error("Error fetching summary:", error)
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
          <CardTitle>Kebir Defteri</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kebir Defteri</CardTitle>
          <CardDescription>Hesap bazlı özet görüntüleyin</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
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
            <div className="flex items-end">
              <Button onClick={fetchSummary}>Filtrele</Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hesap Kodu</TableHead>
                <TableHead>Hesap Adı</TableHead>
                <TableHead>Borç Toplam</TableHead>
                <TableHead>Alacak Toplam</TableHead>
                <TableHead>Bakiye</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Henüz veri bulunmuyor
                  </TableCell>
                </TableRow>
              ) : (
                summary.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{item.accountCode}</TableCell>
                    <TableCell>{item.accountName}</TableCell>
                    <TableCell>{formatCurrency(item.debitTotal)}</TableCell>
                    <TableCell>{formatCurrency(item.creditTotal)}</TableCell>
                    <TableCell>{formatCurrency(item.balance)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

