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

interface AccountingEntry {
  id: string
  entryNo: string
  date: string
  description?: string
  debitAccount: { code: string; name: string }
  creditAccount: { code: string; name: string }
  amount: number
}

export default function YevmiyePage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [entries, setEntries] = useState<AccountingEntry[]>([])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  useEffect(() => {
    if (companyId) {
      fetchEntries()
    }
  }, [companyId, startDate, endDate])

  const fetchEntries = async () => {
    if (!companyId) return
    try {
      const params = new URLSearchParams({ companyId })
      if (startDate) params.append("startDate", startDate)
      if (endDate) params.append("endDate", endDate)

      const response = await fetch(`/api/muhasebe/fisler?${params}`)
      if (response.ok) {
        const data = await response.json()
        setEntries(data)
      }
    } catch (error) {
      console.error("Error fetching entries:", error)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("tr-TR")
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Yevmiye Defteri</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Yevmiye Defteri</CardTitle>
          <CardDescription>Muhasebe fişlerini görüntüleyin</CardDescription>
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
              <Button onClick={fetchEntries}>Filtrele</Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Fiş No</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead>Borç Hesap</TableHead>
                <TableHead>Alacak Hesap</TableHead>
                <TableHead>Tutar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Henüz fiş bulunmuyor
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDate(entry.date)}</TableCell>
                    <TableCell className="font-medium">{entry.entryNo}</TableCell>
                    <TableCell>{entry.description || "-"}</TableCell>
                    <TableCell>
                      {entry.debitAccount.code} - {entry.debitAccount.name}
                    </TableCell>
                    <TableCell>
                      {entry.creditAccount.code} - {entry.creditAccount.name}
                    </TableCell>
                    <TableCell>{formatCurrency(Number(entry.amount))}</TableCell>
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

