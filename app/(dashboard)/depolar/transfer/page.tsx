"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus } from "lucide-react"

interface Transfer {
  id: string
  createdAt: string
  quantity: number
  product: {
    name: string
  }
  warehouse: {
    name: string
  } | null
  notes?: string
}

export default function DepoTransferPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchTransfers()
    }
  }, [companyId])

  const fetchTransfers = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/depolar/transfer?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setTransfers(data)
      }
    } catch (error) {
      console.error("Error fetching transfers:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Depo Transfer İşlemleri</CardTitle>
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
              <CardTitle>Depo Transfer İşlemleri</CardTitle>
              <CardDescription>Depolar arası transfer kayıtları</CardDescription>
            </div>
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Transfer
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz transfer kaydı bulunmuyor
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Ürün</TableHead>
                  <TableHead>Depo</TableHead>
                  <TableHead className="text-right">Miktar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => (
                  <TableRow key={transfer.id}>
                    <TableCell>
                      {new Date(transfer.createdAt).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell className="font-medium">{transfer.product.name}</TableCell>
                    <TableCell>{transfer.warehouse?.name || "-"}</TableCell>
                    <TableCell className={`text-right ${transfer.quantity >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {transfer.quantity > 0 ? "+" : ""}{transfer.quantity.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
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

