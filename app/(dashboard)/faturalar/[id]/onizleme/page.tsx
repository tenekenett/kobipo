"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download, ArrowLeft, Pencil, ShieldCheck, FileDown, Ban, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Hash } from "lucide-react"
import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { parseGibStatus } from "@/lib/integrations/e-invoice/status-display"

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
  uuid?: string | null
  integrationStatus?: string | null
  integrationId?: string | null
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
    discountRate?: number
    discountAmount?: number
    vatRate: number
    vatAmount: number
    totalAmount: number
  }>
}

export default function FaturaOnizlemePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const invoiceId = params.id as string
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [template, setTemplate] = useState("standart")
  const [email, setEmail] = useState("")
  const [attachments, setAttachments] = useState<any[]>([])
  const [attachmentName, setAttachmentName] = useState("")
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [isDownloadingGibPdf, setIsDownloadingGibPdf] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isSendingToProvider, setIsSendingToProvider] = useState(false)

  useEffect(() => {
    if (!invoiceId) return
    setIsLoading(true)
    setLoadError(null)
    setInvoice(null)
    void fetchInvoice()
  }, [invoiceId, companyId])

  const fetchInvoice = async () => {
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}${qs}`)
      if (response.ok) {
        const data = await response.json()
        if (!data.items) {
          data.items = []
        }
        setInvoice(data)
        fetchAttachments()
        setLoadError(null)
        return
      }
      const body = await response.json().catch(() => ({}))
      const msg =
        response.status === 401
          ? "Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yapın."
          : response.status === 403
            ? "Bu faturaya erişim yetkiniz yok."
            : response.status === 400 && body.code === "COMPANY_MISMATCH"
              ? body.error ||
                "Bu fatura seçili firmaya ait değil. Üstten doğru şubeyi seçin veya Faturalar listesinden açın."
              : response.status === 404
                ? "Fatura bulunamadı veya silinmiş."
                : body.error || `Fatura yüklenemedi (${response.status}).`
      setLoadError(msg)
    } catch (error) {
      console.error("Error fetching invoice:", error)
      setLoadError("Fatura yüklenirken bir hata oluştu.")
    } finally {
      setIsLoading(false)
    }
  }

  const fetchAttachments = async () => {
    if (!companyId) return
    const response = await fetch(`/api/attachments?companyId=${companyId}&entityType=invoice&entityId=${invoiceId}`)
    if (response.ok) setAttachments(await response.json())
  }

  const handleDownloadPDF = () => {
    window.open(`/api/faturalar/${invoiceId}/pdf?template=${template}`, "_blank")
  }

  const handleCheckStatus = async () => {
    if (!invoice) return
    setIsCheckingStatus(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}/check-status`, { method: "POST" })
      const data = await response.json()
      if (response.ok) {
        toast({
          title: `GİB Durumu: ${data.message}`,
          description: data.rawText ? `Mysoft kodu: ${data.rawText}` : undefined,
        })
        fetchInvoice()
      } else {
        toast({ title: "Sorgulanamadı", description: data.error || "Bilinmeyen hata", variant: "destructive" })
      }
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "Hata oluştu", variant: "destructive" })
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
        toast({ title: "PDF indirilemedi", description: data.error || "Bilinmeyen hata", variant: "destructive" })
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `Fatura_${invoice.invoiceNo}_GIB.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: "Resmî PDF indirildi" })
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "PDF indirilirken hata oluştu", variant: "destructive" })
    } finally {
      setIsDownloadingGibPdf(false)
    }
  }

  const handleCancelInvoice = async () => {
    if (!invoice) return
    const note = window.prompt("İptal sebebi girin (en az 3 karakter):", "Kullanıcı tarafından iptal edildi")
    if (note === null) return
    if (note.trim().length < 3) {
      toast({ title: "İptal sebebi en az 3 karakter olmalı", variant: "destructive" })
      return
    }
    if (!confirm("e-Arşiv faturayı iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.")) return
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
        toast({ title: "İptal edilemedi", description: data.error || "Bilinmeyen hata", variant: "destructive" })
      }
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "İptal sırasında hata oluştu", variant: "destructive" })
    } finally {
      setIsCancelling(false)
    }
  }

  const handleSendToProvider = async () => {
    if (!invoice) return
    if (!confirm("Bu faturayı göndermek istediğinize emin misiniz?\n\nGönderildikten sonra fatura yasal olarak kesilmiş sayılır.")) return
    setIsSendingToProvider(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}`, {
        method: "POST",
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Gönderilemedi")
      }
      toast({
        title: "Fatura gönderildi",
        description: data.uuid ? `ETTN: ${data.uuid}` : "Fatura başarıyla iletildi.",
      })
      fetchInvoice()
    } catch (error: any) {
      toast({
        title: "Gönderim başarısız",
        description: error?.message || "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setIsSendingToProvider(false)
    }
  }

  const handleSendEmail = async () => {
    const response = await fetch(`/api/faturalar/${invoiceId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    if (!response.ok) {
      alert("E-posta gönderilemedi")
      return
    }
    alert("E-posta gönderimi kuyruğa alındı")
  }

  const createAttachment = async () => {
    if (!attachmentName || !companyId) return
    const response = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        entityType: "invoice",
        entityId: invoiceId,
        fileName: attachmentName,
        mimeType: "application/octet-stream",
      }),
    })
    if (response.ok) {
      setAttachmentName("")
      fetchAttachments()
    }
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
      <div className="mx-auto max-w-lg space-y-4 p-8 text-center">
        <p className="text-muted-foreground">{loadError || "Fatura bulunamadı"}</p>
        {companyId ? (
          <Button variant="outline" asChild>
            <Link href={`/faturalar?company=${encodeURIComponent(companyId)}`}>Faturalara dön</Link>
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link href="/faturalar">Faturalara dön</Link>
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/faturalar?company=${companyId || ""}`}>
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
        <div className="flex items-center gap-2 flex-wrap">
          {invoice.status === "DRAFT" && (
            <Link
              href={`/e-donusum/${invoiceId}/duzenle?company=${encodeURIComponent(companyId || "")}&from=${encodeURIComponent(`/faturalar/${invoiceId}/onizleme`)}`}
            >
              <Button variant="outline">
                <Pencil className="h-4 w-4 mr-2" />
                Düzenle
              </Button>
            </Link>
          )}
          {invoice.status === "DRAFT" &&
            !invoice.uuid &&
            (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
              <Button
                onClick={handleSendToProvider}
                disabled={isSendingToProvider}
                className="bg-kobipo-blue hover:bg-kobipo-blue/90 dark:bg-primary dark:hover:bg-primary/90"
              >
                {isSendingToProvider ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Gönder
              </Button>
            )}
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standart">Standart</SelectItem>
              <SelectItem value="kurumsal">Kurumsal</SelectItem>
            </SelectContent>
          </Select>
          <Input className="w-56" placeholder="E-posta (opsiyonel)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button variant="outline" onClick={handleSendEmail}>E-posta Gönder</Button>
          <Button onClick={handleDownloadPDF}>
            <Download className="h-4 w-4 mr-2" />
            PDF İndir
          </Button>
          {invoice.uuid && (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
            <>
              <Button variant="outline" onClick={handleCheckStatus} disabled={isCheckingStatus}>
                {isCheckingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                GİB Durumu
              </Button>
              <Button
                variant="outline"
                onClick={handleDownloadGibPdf}
                disabled={isDownloadingGibPdf}
                title="Mysoft / GİB tarafından üretilen yasal PDF"
              >
                {isDownloadingGibPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                Resmî PDF (GİB)
              </Button>
              {invoice.invoiceType === "E_ARCHIVE" && invoice.status !== "CANCELLED" && (
                <Button
                  variant="outline"
                  onClick={handleCancelInvoice}
                  disabled={isCancelling}
                  className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                >
                  {isCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                  İptal Et
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Durum şeridi: iç status + GİB durumu + ETTN */}
      {(invoice.uuid || invoice.integrationStatus) && (
        <div className="flex items-center gap-2 flex-wrap">
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
      )}

      {/* Hatalı entegrasyon durumunda kullanıcıya somut bir CTA göster */}
      {typeof invoice.integrationStatus === "string" &&
        invoice.integrationStatus.startsWith("ERROR:") && (() => {
          const errMsg = invoice.integrationStatus!.replace(/^ERROR:/, "")
          const isNumeratorError = /numarat[öo]r/i.test(errMsg)
          return (
            <div className="flex flex-wrap items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Mysoft gönderimi başarısız</p>
                <p className="mt-1 break-words">{errMsg}</p>
                {isNumeratorError && companyId && (
                  <div className="mt-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/e-donusum/seri-no?company=${encodeURIComponent(companyId)}`}>
                        <Hash className="mr-2 h-4 w-4" />
                        Seri No Tanımları'na git
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

      <Card>
        <CardHeader>
          <CardTitle>
            {invoice.invoiceType === "E_INVOICE"
              ? "E-FATURA"
              : invoice.invoiceType === "E_ARCHIVE"
                ? "E-ARŞİV FATURA"
                : "FATURA"}
          </CardTitle>
          <CardDescription>
            {invoice.type === "SALES"
              ? "Satış Faturası"
              : invoice.type === "PURCHASE"
                ? "Alış Faturası"
                : invoice.type === "RETURN"
                  ? "İade Faturası"
                  : invoice.type}
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
                <TableHead className="text-right">Iskonto</TableHead>
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
                    <TableCell className="text-right">
                      -{formatCurrency(Number(item.discountAmount || 0))}
                      {Number(item.discountRate || 0) > 0 && (
                        <div className="text-xs text-muted-foreground">%{Number(item.discountRate || 0)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">%{Number(item.vatRate || 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.vatAmount || 0))}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(Number(item.totalAmount || 0))}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
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
      <Card>
        <CardHeader><CardTitle>Ek Belgeler</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Dosya adı (simülasyon)" value={attachmentName} onChange={(e) => setAttachmentName(e.target.value)} />
            <Button onClick={createAttachment}>Ekle</Button>
          </div>
          {attachments.map((attachment) => (
            <div key={attachment.id} className="rounded border p-2 text-sm">
              {attachment.fileName} - <span className="text-muted-foreground">{attachment.filePath}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

