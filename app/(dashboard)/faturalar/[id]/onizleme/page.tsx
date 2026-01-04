"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface Invoice {
  id: string
  invoiceNo: string
  date: string
  dueDate?: string
  type: string
  invoiceType: string
  status: string
  netAmount: number
  vatAmount: number
  totalAmount: number
  notes?: string
  customer?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
  }
  supplier?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
  }
  company: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
  }
  items: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: number
    vatRate: number
    vatAmount: number
    totalAmount: number
  }>
}

export default function FaturaOnizlemePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const invoiceId = params.id as string
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (invoiceId) {
      fetchInvoice()
    }
  }, [invoiceId])

  const fetchInvoice = async () => {
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}`)
      if (response.ok) {
        const data = await response.json()
        // Ensure items array exists
        if (!data.items) {
          data.items = []
        }
        setInvoice(data)
      } else {
        console.error("Failed to fetch invoice:", response.status)
      }
    } catch (error) {
      console.error("Error fetching invoice:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownloadPDF = () => {
    window.open(`/api/faturalar/${invoiceId}/pdf`, "_blank")
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Yükleniyor...</p>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Fatura bulunamadı</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/faturalar">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Geri
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Fatura Önizleme</h1>
            <p className="text-muted-foreground">Fatura No: {invoice.invoiceNo}</p>
          </div>
        </div>
        <Button onClick={handleDownloadPDF}>
          <Download className="h-4 w-4 mr-2" />
          PDF İndir
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {invoice.invoiceType === "E_INVOICE" ? "E-FATURA" : "E-ARŞİV FATURA"}
          </CardTitle>
          <CardDescription>
            {invoice.type === "SALES" ? "Satış Faturası" : "Alış Faturası"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="font-bold text-sm mb-2 text-muted-foreground">FİRMA BİLGİLERİ</h3>
              <p className="font-medium">{invoice.company.name}</p>
              {invoice.company.taxNumber && (
                <p className="text-sm text-muted-foreground">VKN: {invoice.company.taxNumber}</p>
              )}
              {invoice.company.address && (
                <p className="text-sm text-muted-foreground">{invoice.company.address}</p>
              )}
              {invoice.company.city && (
                <p className="text-sm text-muted-foreground">{invoice.company.city}</p>
              )}
            </div>
            <div>
              <h3 className="font-bold text-sm mb-2 text-muted-foreground">
                {invoice.type === "SALES" ? "MÜŞTERİ BİLGİLERİ" : "TEDARİKÇİ BİLGİLERİ"}
              </h3>
              {invoice.type === "SALES" && invoice.customer ? (
                <>
                  <p className="font-medium">{invoice.customer.name}</p>
                  {invoice.customer.taxNumber && (
                    <p className="text-sm text-muted-foreground">VKN: {invoice.customer.taxNumber}</p>
                  )}
                  {invoice.customer.address && (
                    <p className="text-sm text-muted-foreground">{invoice.customer.address}</p>
                  )}
                  {invoice.customer.city && (
                    <p className="text-sm text-muted-foreground">{invoice.customer.city}</p>
                  )}
                </>
              ) : invoice.supplier ? (
                <>
                  <p className="font-medium">{invoice.supplier.name}</p>
                  {invoice.supplier.taxNumber && (
                    <p className="text-sm text-muted-foreground">VKN: {invoice.supplier.taxNumber}</p>
                  )}
                  {invoice.supplier.address && (
                    <p className="text-sm text-muted-foreground">{invoice.supplier.address}</p>
                  )}
                  {invoice.supplier.city && (
                    <p className="text-sm text-muted-foreground">{invoice.supplier.city}</p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Bilgi yok</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-6">
            <div>
              <p className="text-sm text-muted-foreground">Fatura No</p>
              <p className="font-medium">{invoice.invoiceNo}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Tarih</p>
              <p className="font-medium">{new Date(invoice.date).toLocaleDateString("tr-TR")}</p>
            </div>
            {invoice.dueDate && (
              <div>
                <p className="text-sm text-muted-foreground">Vade Tarihi</p>
                <p className="font-medium">{new Date(invoice.dueDate).toLocaleDateString("tr-TR")}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Durum</p>
              <p className="font-medium">
                {invoice.status === "SENT" ? "Gönderildi" : invoice.status === "DRAFT" ? "Taslak" : invoice.status}
              </p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">KDV %</TableHead>
                <TableHead className="text-right">KDV Tutarı</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items && invoice.items.length > 0 ? (
                invoice.items.map((item: any, index: number) => (
                  <TableRow key={item.id || index}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{item.description || "-"}</TableCell>
                    <TableCell className="text-right">
                      {Number(item.quantity || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.unitPrice || 0))}</TableCell>
                    <TableCell className="text-right">%{Number(item.vatRate || 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.vatAmount || 0))}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(Number(item.totalAmount || 0))}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Fatura kalemi bulunamadı
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex justify-end mt-6">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ara Toplam:</span>
                <span>{formatCurrency(invoice.netAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">KDV Toplam:</span>
                <span>{formatCurrency(invoice.vatAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-2">
                <span>Genel Toplam:</span>
                <span className="text-green-600">{formatCurrency(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-6 p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">Notlar:</p>
              <p className="text-sm text-muted-foreground">{invoice.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

