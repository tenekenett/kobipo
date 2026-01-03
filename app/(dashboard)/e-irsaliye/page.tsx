"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus } from "lucide-react"
import Link from "next/link"

interface Waybill {
  id: string
  waybillNo: string
  type: string
  status: string
  date: string
  deliveryDate?: string
  carrier?: string
  vehicleNo?: string
  customer?: { name: string }
  supplier?: { name: string }
  invoice?: { invoiceNo: string }
}

export default function EirsaliyePage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [waybills, setWaybills] = useState<Waybill[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchWaybills()
    }
  }, [companyId])

  const fetchWaybills = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/e-irsaliye?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setWaybills(data)
      }
    } catch (error) {
      console.error("Error fetching waybills:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("tr-TR")
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>E-İrsaliye</CardTitle>
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
              <CardTitle>E-İrsaliye</CardTitle>
              <CardDescription>E-İrsaliye yönetimi</CardDescription>
            </div>
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" />
              Yeni İrsaliye
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : waybills.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz irsaliye bulunmuyor
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>İrsaliye No</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>Müşteri/Tedarikçi</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Taşıyıcı</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waybills.map((waybill) => (
                  <TableRow key={waybill.id}>
                    <TableCell className="font-medium">{waybill.waybillNo}</TableCell>
                    <TableCell>
                      <Badge variant={waybill.type === "SALES" ? "default" : "secondary"}>
                        {waybill.type === "SALES" ? "Satış" : "Alış"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {waybill.customer?.name || waybill.supplier?.name || "-"}
                    </TableCell>
                    <TableCell>{formatDate(waybill.date)}</TableCell>
                    <TableCell>{waybill.carrier || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={
                        waybill.status === "SENT" ? "default" :
                        waybill.status === "DELIVERED" ? "default" :
                        waybill.status === "CANCELLED" ? "destructive" : "secondary"
                      }>
                        {waybill.status === "SENT" ? "Gönderildi" :
                         waybill.status === "DELIVERED" ? "Teslim Edildi" :
                         waybill.status === "CANCELLED" ? "İptal" : "Taslak"}
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

