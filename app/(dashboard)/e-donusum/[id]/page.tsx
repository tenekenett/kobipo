"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { ArrowLeft, Download, Send, Printer, ShieldCheck, Loader2, CheckCircle2, XCircle, Clock, Ban, FileDown } from "lucide-react"
import Link from "next/link"
import { generateInvoicePDF } from "@/lib/pdf/invoice-pdf"
import { parseGibStatus } from "@/lib/integrations/e-invoice/status-display"

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  netAmount: number
  vatAmount: number
  totalAmount: number
}

interface Invoice {
  id: string
  invoiceNo: string
  type: "SALES" | "PURCHASE"
  invoiceType: "E_INVOICE" | "E_ARCHIVE"
  status: string
  date: string
  dueDate?: string
  netAmount: number
  vatAmount: number
  totalAmount: number
  notes?: string
  uuid?: string | null
  integrationStatus?: string | null
  integrationId?: string | null
  customer?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    phone?: string
    email?: string
  }
  supplier?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    phone?: string
    email?: string
  }
  company: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    phone?: string
    email?: string
  }
  items: InvoiceItem[]
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  
  const id = params.id as string
  const companyId = searchParams.get("company")
  
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [isDownloadingGibPdf, setIsDownloadingGibPdf] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  useEffect(() => {
    if (id && companyId) {
      fetchInvoice()
    }
  }, [id, companyId])

  const fetchInvoice = async () => {
    try {
      const response = await fetch(`/api/e-donusum/invoices/${id}?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoice(data)
      } else {
        toast({
          title: "Hata",
          description: "Fatura bulunamadı",
          variant: "destructive",
        })
        router.push(`/e-donusum?company=${companyId}`)
      }
    } catch (error) {
      console.error("Error fetching invoice:", error)
      toast({
        title: "Hata",
        description: "Fatura yüklenemedi",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendInvoice = async () => {
    if (!confirm("Faturayı göndermek istediğinize emin misiniz?")) {
      return
    }

    setIsSending(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${id}`, {
        method: "POST",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Fatura gönderildi",
        })
        fetchInvoice()
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
      setIsSending(false)
    }
  }

  const handleCheckStatus = async () => {
    if (!invoice) return
    setIsCheckingStatus(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}/check-status`, {
        method: "POST",
      })
      const data = await response.json()
      if (response.ok) {
        toast({
          title: `GİB Durumu: ${data.message}`,
          description: data.rawText ? `Mysoft kodu: ${data.rawText}` : undefined,
        })
        fetchInvoice()
      } else {
        toast({
          title: "Sorgulanamadı",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "Durum sorgulanırken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsCheckingStatus(false)
    }
  }

  const handleDownloadGibPdf = async () => {
    if (!invoice) return
    setIsDownloadingGibPdf(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}/pdf`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast({
          title: "PDF indirilemedi",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${invoice.invoiceNo}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: "Resmî PDF indirildi" })
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "PDF indirilirken hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsDownloadingGibPdf(false)
    }
  }

  const handleCancelInvoice = async () => {
    if (!invoice) return
    const note = window.prompt(
      "İptal sebebi girin (en az 3 karakter):",
      "Kullanıcı tarafından iptal edildi"
    )
    if (note === null) return
    if (note.trim().length < 3) {
      toast({ title: "İptal sebebi en az 3 karakter olmalı", variant: "destructive" })
      return
    }
    if (!confirm("e-Arşiv faturayı iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.")) {
      return
    }
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelNote: note.trim() }),
      })
      const data = await response.json()
      if (response.ok) {
        toast({ title: "Fatura iptal edildi", description: data.message })
        fetchInvoice()
      } else {
        toast({
          title: "İptal edilemedi",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "İptal sırasında hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsCancelling(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!invoice) return

    const pdfData = {
      invoiceNo: invoice.invoiceNo,
      date: invoice.date,
      dueDate: invoice.dueDate,
      type: invoice.type,
      invoiceType: invoice.invoiceType,
      customer: invoice.customer,
      supplier: invoice.supplier,
      company: invoice.company,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        vatRate: Number(item.vatRate),
        total: Number(item.totalAmount),
      })),
      netAmount: Number(invoice.netAmount),
      vatAmount: Number(invoice.vatAmount),
      totalAmount: Number(invoice.totalAmount),
      notes: invoice.notes,
    }

    await generateInvoicePDF(pdfData)
    
    toast({
      title: "PDF İndirildi",
      description: `Fatura_${invoice.invoiceNo}.pdf dosyası indirildi`,
    })
  }

  const handlePrint = () => {
    window.print()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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

  const recipient = invoice.type === "SALES" ? invoice.customer : invoice.supplier

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Link href={`/e-donusum?company=${companyId}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Fatura #{invoice.invoiceNo}</h1>
            <p className="text-muted-foreground">
              {invoice.invoiceType === "E_INVOICE" ? "E-Fatura" : "E-Arşiv"} | 
              {invoice.type === "SALES" ? " Satış" : " Alış"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Yazdır
          </Button>
          <Button variant="outline" onClick={handleDownloadPDF}>
            <Download className="mr-2 h-4 w-4" />
            PDF İndir
          </Button>
          {invoice.status === "DRAFT" &&
            invoice.type === "SALES" &&
            (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
            <Button onClick={handleSendInvoice} disabled={isSending}>
              <Send className="mr-2 h-4 w-4" />
              {isSending ? "Gönderiliyor..." : "Gönder"}
            </Button>
          )}
          {invoice.uuid && (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
            <>
              <Button
                variant="outline"
                onClick={handleCheckStatus}
                disabled={isCheckingStatus}
              >
                {isCheckingStatus ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                GİB Durumu
              </Button>
              <Button
                variant="outline"
                onClick={handleDownloadGibPdf}
                disabled={isDownloadingGibPdf}
                title="Mysoft / GİB tarafından üretilen yasal PDF"
              >
                {isDownloadingGibPdf ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="mr-2 h-4 w-4" />
                )}
                Resmî PDF (GİB)
              </Button>
              {invoice.invoiceType === "E_ARCHIVE" && invoice.status !== "CANCELLED" && (
                <Button
                  variant="outline"
                  onClick={handleCancelInvoice}
                  disabled={isCancelling}
                  className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                >
                  {isCancelling ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Ban className="mr-2 h-4 w-4" />
                  )}
                  İptal Et
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Status Badge — iç status + GİB durumu */}
      <div className="flex items-center gap-2 flex-wrap print:hidden">
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            invoice.status === "SENT"
              ? "bg-sky-100 text-sky-800"
              : invoice.status === "DRAFT"
              ? "bg-yellow-100 text-yellow-800"
              : invoice.status === "CANCELLED"
              ? "bg-gray-200 text-gray-700"
              : "bg-red-100 text-red-800"
          }`}
        >
          {invoice.status === "SENT"
            ? "Gönderildi"
            : invoice.status === "DRAFT"
            ? "Taslak"
            : invoice.status === "CANCELLED"
            ? "İptal Edildi"
            : invoice.status}
        </span>

        {(() => {
          const gib = parseGibStatus(invoice.integrationStatus)
          if (!gib) return null
          const style = gib.bucket === "approved"
            ? { wrap: "border-emerald-300 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 }
            : gib.bucket === "rejected"
            ? { wrap: "border-red-300 bg-red-50 text-red-800", Icon: XCircle }
            : gib.bucket === "cancelled"
            ? { wrap: "border-gray-300 bg-gray-100 text-gray-700", Icon: Ban }
            : gib.bucket === "processing"
            ? { wrap: "border-amber-300 bg-amber-50 text-amber-800", Icon: Clock }
            : { wrap: "border-slate-300 bg-slate-50 text-slate-700", Icon: ShieldCheck }
          const Icon = style.Icon
          return (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${style.wrap}`}
              title={gib.detail || undefined}
            >
              <Icon className="h-4 w-4" />
              GİB: {gib.label}
            </span>
          )
        })()}

        {invoice.uuid && (
          <span className="text-xs text-muted-foreground font-mono">
            ETTN: {invoice.uuid}
          </span>
        )}
      </div>

      {/* Invoice Content */}
      <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
        {/* Company Info */}
        <Card className="print:shadow-none print:border-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Firma Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-semibold text-base">{invoice.company.name}</p>
            {invoice.company.taxNumber && <p>VKN: {invoice.company.taxNumber}</p>}
            {invoice.company.taxOffice && <p>Vergi Dairesi: {invoice.company.taxOffice}</p>}
            {invoice.company.address && <p>{invoice.company.address}</p>}
            {invoice.company.city && <p>{invoice.company.city}</p>}
            {invoice.company.phone && <p>Tel: {invoice.company.phone}</p>}
            {invoice.company.email && <p>Email: {invoice.company.email}</p>}
          </CardContent>
        </Card>

        {/* Recipient Info */}
        <Card className="print:shadow-none print:border-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {invoice.type === "SALES" ? "Müşteri Bilgileri" : "Tedarikçi Bilgileri"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {recipient ? (
              <>
                <p className="font-semibold text-base">{recipient.name}</p>
                {recipient.taxNumber && <p>VKN: {recipient.taxNumber}</p>}
                {recipient.taxOffice && <p>Vergi Dairesi: {recipient.taxOffice}</p>}
                {recipient.address && <p>{recipient.address}</p>}
                {recipient.city && <p>{recipient.city}</p>}
                {recipient.phone && <p>Tel: {recipient.phone}</p>}
                {recipient.email && <p>Email: {recipient.email}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">Bilgi mevcut değil</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice Details */}
      <Card className="print:shadow-none print:border-none">
        <CardHeader>
          <CardTitle>Fatura Detayları</CardTitle>
          <CardDescription>
            Fatura Tarihi: {new Date(invoice.date).toLocaleDateString("tr-TR")}
            {invoice.dueDate && ` | Vade: ${new Date(invoice.dueDate).toLocaleDateString("tr-TR")}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">KDV %</TableHead>
                <TableHead className="text-right">KDV Tutarı</TableHead>
                <TableHead className="text-right">Toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoice.items || []).map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell className="text-right">
                    {Number(item.quantity).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ₺{Number(item.unitPrice).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">{Number(item.vatRate)}%</TableCell>
                  <TableCell className="text-right">
                    ₺{Number(item.vatAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ₺{Number(item.totalAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Totals */}
          <div className="flex justify-end mt-6">
            <div className="w-72 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ara Toplam:</span>
                <span>₺{Number(invoice.netAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">KDV Toplam:</span>
                <span>₺{Number(invoice.vatAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-2">
                <span>Genel Toplam:</span>
                <span className="text-green-600">
                  ₺{Number(invoice.totalAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      {invoice.notes && (
        <Card className="print:shadow-none print:border-none">
          <CardHeader>
            <CardTitle className="text-lg">Notlar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

