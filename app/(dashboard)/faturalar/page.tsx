"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
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
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { Eye, Plus, FileText, Pencil, Trash2, ShieldCheck, Loader2, FileDown } from "lucide-react"
import Link from "next/link"

interface Invoice {
  id: string
  invoiceNo: string
  type: string
  status: string
  date: string
  dueDate?: string
  totalAmount: number
  uuid?: string | null
  invoiceType?: string
  integrationStatus?: string | null
  customer?: { name: string }
  supplier?: { name: string }
  payments?: Array<{ amount: number }>
}

interface Company {
  id: string
  isEDonusumEnabled?: boolean
}

export default function FaturalarPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const typeFilter = searchParams.get("type")?.toUpperCase()
  const { toast } = useToast()
  
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [checkingStatusId, setCheckingStatusId] = useState<string | null>(null)
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null)

  useEffect(() => {
    if (companyId) {
      fetchInvoices()
      fetchCompany()
    }
  }, [companyId])

  const fetchCompany = async () => {
    if (!companyId) return
    try {
      const response = await fetch("/api/companies")
      if (!response.ok) return
      const companies = (await response.json()) as Company[]
      setCompany(companies.find((item) => item.id === companyId) || null)
    } catch (error) {
      console.error("Error fetching company:", error)
    }
  }

  const fetchInvoices = async () => {
    if (!companyId) return
    setIsLoading(true)
    setListError(null)
    try {
      const response = await fetch(`/api/e-donusum/invoices?companyId=${companyId}`)
      if (response.ok) {
        const data = (await response.json()) as Invoice[]
        setInvoices(data)
        return
      }
      const body = await response.json().catch(() => ({}))
      const msg =
        response.status === 401
          ? "Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yapın."
          : body.error || `Faturalar yüklenemedi (${response.status}).`
      setListError(msg)
      setInvoices([])
      toast({
        title: "Faturalar yüklenemedi",
        description: msg,
        variant: "destructive",
      })
    } catch (error) {
      console.error("Error fetching invoices:", error)
      setListError("Faturalar yüklenirken bir hata oluştu.")
      setInvoices([])
      toast({
        title: "Hata",
        description: "Faturalar yüklenirken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownloadGibPdf = async (invoiceId: string, invoiceNo: string) => {
    setDownloadingPdfId(invoiceId)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}/pdf`)
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
      a.download = `Fatura_${invoiceNo}_GIB.pdf`
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
      setDownloadingPdfId(null)
    }
  }

  const handleCheckStatus = async (invoiceId: string) => {
    setCheckingStatusId(invoiceId)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}/check-status`, {
        method: "POST",
      })
      const data = await response.json()
      if (response.ok) {
        toast({
          title: `Durum: ${data.message}`,
          description: data.rawText ? `Mysoft kodu: ${data.rawText}` : undefined,
        })
        fetchInvoices()
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
      setCheckingStatusId(null)
    }
  }

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm("Bu faturayı silmek/iptal etmek istediğinize emin misiniz? (Bu işlem stokları ve bakiyeleri geri alacaktır)")) {
      return
    }

    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}?companyId=${companyId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Fatura başarıyla silindi.",
        })
        fetchInvoices() // Listeyi yenile
      } else {
        const data = await response.json()
        toast({
          title: "Hata",
          description: data.error || "Fatura silinemedi",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Silme işlemi sırasında bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const getPaymentStatus = (invoice: Invoice) => {
    const totalPaid = invoice.payments?.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    ) || 0
    const remaining = Number(invoice.totalAmount) - totalPaid

    if (remaining <= 0) {
      return { status: "ODENMIS", label: "Ödendi", variant: "default" as const }
    } else if (totalPaid > 0) {
      return { status: "KISMEN_ODENDI", label: "Kısmen Ödendi", variant: "secondary" as const }
    } else {
      return { status: "ODENMEDI", label: "Ödenmedi", variant: "destructive" as const }
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

  const handleCreateInvoice = () => {
    if (!companyId) return
    const fromParam = `&from=${encodeURIComponent("/faturalar")}`
    const target = company?.isEDonusumEnabled
      ? `/e-donusum/yeni?company=${encodeURIComponent(companyId)}${fromParam}`
      : `/e-donusum/yeni?company=${encodeURIComponent(companyId)}&manual=1${fromParam}`
    router.push(target)
  }

  const invoiceTypeLabel = (type: string) =>
    type === "SALES" ? "Satış" : type === "PURCHASE" ? "Alış" : type === "RETURN" ? "İade" : type

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Faturalar</CardTitle>
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
              <CardTitle>
                {typeFilter === "SALES"
                  ? "Satış Faturaları"
                  : typeFilter === "PURCHASE"
                  ? "Alış Faturaları"
                  : "Faturalar"}
              </CardTitle>
              <CardDescription>
                {typeFilter === "SALES"
                  ? "Müşterilerinize kestiğiniz satış faturalarını yönetin"
                  : typeFilter === "PURCHASE"
                  ? "Tedarikçilerden gelen alış faturalarını yönetin"
                  : "Tüm faturalarınızı görüntüleyin ve yönetin"}
              </CardDescription>
            </div>
            <Button onClick={handleCreateInvoice}>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Fatura
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const visibleInvoices = typeFilter
              ? invoices.filter((inv) => inv.type === typeFilter)
              : invoices
            if (isLoading) {
              return <div className="text-center py-8">Yükleniyor...</div>
            }
            if (listError) {
              return <div className="space-y-2 py-8 text-center text-sm text-destructive">{listError}</div>
            }
            if (visibleInvoices.length === 0) {
              return (
                <div className="text-center py-8 text-muted-foreground">
                  {typeFilter
                    ? `Henüz ${typeFilter === "SALES" ? "satış" : "alış"} faturası bulunmuyor`
                    : "Henüz fatura bulunmuyor"}
                </div>
              )
            }
            return (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fatura No</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>Müşteri/Tedarikçi</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Vade</TableHead>
                  <TableHead>Tutar</TableHead>
                  <TableHead>Ödeme Durumu</TableHead>
                  <TableHead>İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInvoices.map((invoice) => {
                  const paymentStatus = getPaymentStatus(invoice)
                  const totalPaid = invoice.payments?.reduce(
                    (sum, p) => sum + Number(p.amount),
                    0
                  ) || 0
                  const remaining = Number(invoice.totalAmount) - totalPaid

                  return (
                    <TableRow
                      key={invoice.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        router.push(`/faturalar/${invoice.id}/onizleme?company=${companyId}`)
                      }
                    >
                      <TableCell className="font-medium">
                        {invoice.invoiceNo}
                      </TableCell>
                      <TableCell>
                        <Badge variant={invoice.type === "SALES" ? "default" : "secondary"}>
                          {invoiceTypeLabel(invoice.type)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {invoice.customer?.name || invoice.supplier?.name || "-"}
                      </TableCell>
                      <TableCell>{formatDate(invoice.date)}</TableCell>
                      <TableCell>
                        {invoice.dueDate ? formatDate(invoice.dueDate) : "-"}
                      </TableCell>
                      <TableCell>{formatCurrency(Number(invoice.totalAmount))}</TableCell>
                      <TableCell>
                        <Badge variant={paymentStatus.variant}>
                          {paymentStatus.label}
                        </Badge>
                        {totalPaid > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Ödenen: {formatCurrency(totalPaid)} / Kalan: {formatCurrency(remaining)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2">
                          <Link href={`/faturalar/${invoice.id}/onizleme?company=${companyId}`}>
                            <Button variant="outline" size="sm" title="Önizleme">
                              <FileText className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link href={`/faturalar/${invoice.id}/odemeler?company=${companyId}`}>
                            <Button variant="outline" size="sm" title="Ödemeler">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {(() => {
                            const editable = invoice.status === "DRAFT"
                            const editBtn = (
                              <Button
                                variant="outline"
                                size="sm"
                                title={editable ? "Düzenle" : "Sadece taslak faturalar düzenlenebilir"}
                                disabled={!editable}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )
                            return editable ? (
                              <Link
                                href={`/e-donusum/${invoice.id}/duzenle?company=${encodeURIComponent(companyId)}&from=${encodeURIComponent("/faturalar")}`}
                              >
                                {editBtn}
                              </Link>
                            ) : (
                              editBtn
                            )
                          })()}
                          {(() => {
                            const isEDoc = invoice.invoiceType === "E_ARCHIVE" || invoice.invoiceType === "E_INVOICE"
                            const canCheck = Boolean(invoice.uuid && isEDoc)
                            const isLoading = checkingStatusId === invoice.id
                            return (
                              <Button
                                variant="outline"
                                size="sm"
                                title={
                                  !isEDoc
                                    ? "Sadece e-Fatura / e-Arşiv için"
                                    : !invoice.uuid
                                    ? "Henüz Mysoft'a gönderilmemiş"
                                    : "GİB Durum Sorgula"
                                }
                                onClick={() => canCheck && handleCheckStatus(invoice.id)}
                                disabled={!canCheck || isLoading}
                              >
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                              </Button>
                            )
                          })()}
                          {(() => {
                            const isEDoc = invoice.invoiceType === "E_ARCHIVE" || invoice.invoiceType === "E_INVOICE"
                            const canDownload = Boolean(invoice.uuid && isEDoc)
                            const isLoading = downloadingPdfId === invoice.id
                            return (
                              <Button
                                variant="outline"
                                size="sm"
                                title={
                                  !isEDoc
                                    ? "Sadece e-Fatura / e-Arşiv için"
                                    : !invoice.uuid
                                    ? "Henüz Mysoft'a gönderilmemiş"
                                    : "Resmî PDF (GİB) İndir"
                                }
                                onClick={() => canDownload && handleDownloadGibPdf(invoice.id, invoice.invoiceNo)}
                                disabled={!canDownload || isLoading}
                              >
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                              </Button>
                            )
                          })()}
                          {/* YENİ SİLME BUTONU */}
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleDeleteInvoice(invoice.id)}
                            title="Sil / İptal Et"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            )
          })()}
        </CardContent>
      </Card>
    </div>
  )
}