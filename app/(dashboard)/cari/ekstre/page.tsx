"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

interface EkstreEntry {
  type: string
  id: string
  date: string
  description: string
  debit: number
  credit: number
  balance: number
  reference?: string
}

export default function EkstrePage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [entries, setEntries] = useState<EkstreEntry[]>([])
  const [totalDebit, setTotalDebit] = useState(0)
  const [totalCredit, setTotalCredit] = useState(0)
  const [finalBalance, setFinalBalance] = useState(0)
  const [customerId, setCustomerId] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchEkstre()
    }
  }, [companyId, customerId, supplierId, startDate, endDate])

  const fetchEkstre = async () => {
    if (!companyId) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        ...(customerId && { customerId }),
        ...(supplierId && { supplierId }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })

      const response = await fetch(`/api/cari/ekstre?${params}`)
      if (response.ok) {
        const data = await response.json()
        setEntries(data.entries)
        setTotalDebit(data.totalDebit)
        setTotalCredit(data.totalCredit)
        setFinalBalance(data.finalBalance)
      }
    } catch (error) {
      console.error("Error fetching ekstre:", error)
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
        <h1 className="text-3xl font-bold">Cari Ekstre</h1>
        <p className="text-muted-foreground">Cari hesap hareketleri</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtreler</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="customerId">Müşteri ID</Label>
              <Input
                id="customerId"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Müşteri ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplierId">Tedarikçi ID</Label>
              <Input
                id="supplierId"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="Tedarikçi ID"
              />
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cari Ekstre</CardTitle>
          <CardDescription>
            Toplam Borç: {new Intl.NumberFormat("tr-TR", {
              style: "currency",
              currency: "TRY",
            }).format(totalDebit)}
            {" | "}
            Toplam Alacak: {new Intl.NumberFormat("tr-TR", {
              style: "currency",
              currency: "TRY",
            }).format(totalCredit)}
            {" | "}
            Bakiye: {new Intl.NumberFormat("tr-TR", {
              style: "currency",
              currency: "TRY",
            }).format(finalBalance)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Açıklama</TableHead>
                  <TableHead>Referans</TableHead>
                  <TableHead className="text-right">Borç</TableHead>
                  <TableHead className="text-right">Alacak</TableHead>
                  <TableHead className="text-right">Bakiye</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">
                      Kayıt bulunamadı
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        {new Date(entry.date).toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell>{entry.description}</TableCell>
                      <TableCell>{entry.reference || "-"}</TableCell>
                      <TableCell className="text-right">
                        {entry.debit > 0
                          ? new Intl.NumberFormat("tr-TR", {
                              style: "currency",
                              currency: "TRY",
                            }).format(entry.debit)
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.credit > 0
                          ? new Intl.NumberFormat("tr-TR", {
                              style: "currency",
                              currency: "TRY",
                            }).format(entry.credit)
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {new Intl.NumberFormat("tr-TR", {
                          style: "currency",
                          currency: "TRY",
                        }).format(entry.balance)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

