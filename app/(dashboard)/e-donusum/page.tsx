"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Send } from "lucide-react"
import Link from "next/link"

interface Invoice {
  id: string
  invoiceNo: string
  type: string
  invoiceType: string
  status: string
  date: string
  totalAmount: number
  customer?: { name: string }
  supplier?: { name: string }
  uuid?: string
}

export default function EDönüşümPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchInvoices()
    }
  }, [companyId])

  const fetchInvoices = async () => {
    if (!companyId) return

    try {
      const response = await fetch(`/api/e-donusum/invoices?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoices(data)
      }
    } catch (error) {
      console.error("Error fetching invoices:", error)
    }
  }

  const handleSendInvoice = async (invoiceId: string) => {
    if (!confirm("Faturayı göndermek istediğinize emin misiniz?")) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}`, {
        method: "POST",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Fatura gönderildi",
        })
        fetchInvoices()
      } else {
        const data = await response.json()
        throw new Error(data.error || "Gönderilemedi")
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Bir hata oluştu",
        variant: "destructive",
      })
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">E-Dönüşüm</h1>
          <p className="text-muted-foreground">
            E-Fatura ve E-Arşiv fatura yönetimi
          </p>
        </div>
        <Link href={`/dashboard/e-donusum/yeni?company=${companyId}`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Fatura
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Faturalar</CardTitle>
          <CardDescription>
            Toplam {invoices.length} fatura
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fatura No</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead>Tarih</TableHead>
                <TableHead>Müşteri/Tedarikçi</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">
                    Kayıt bulunamadı
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                    <TableCell>
                      {invoice.type === "SALES" ? "Satış" : "Alış"}
                    </TableCell>
                    <TableCell>
                      {invoice.invoiceType === "E_INVOICE" ? "E-Fatura" : "E-Arşiv"}
                    </TableCell>
                    <TableCell>
                      {new Date(invoice.date).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      {invoice.customer?.name || invoice.supplier?.name || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {new Intl.NumberFormat("tr-TR", {
                        style: "currency",
                        currency: "TRY",
                      }).format(Number(invoice.totalAmount))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          invoice.status === "SENT"
                            ? "bg-green-100 text-green-800"
                            : invoice.status === "DRAFT"
                            ? "bg-gray-100 text-gray-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {invoice.status === "SENT"
                          ? "Gönderildi"
                          : invoice.status === "DRAFT"
                          ? "Taslak"
                          : invoice.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Link href={`/dashboard/e-donusum/${invoice.id}?company=${companyId}`}>
                          <Button variant="outline" size="sm">
                            Görüntüle
                          </Button>
                        </Link>
                        {invoice.status === "DRAFT" &&
                          (invoice.invoiceType === "E_INVOICE" ||
                            invoice.invoiceType === "E_ARCHIVE") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSendInvoice(invoice.id)}
                              disabled={isLoading}
                            >
                              <Send className="mr-1 h-3 w-3" />
                              Gönder
                            </Button>
                          )}
                      </div>
                    </TableCell>
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

