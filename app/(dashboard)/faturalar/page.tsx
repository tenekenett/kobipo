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
import { Eye, Plus, FileText, Pencil } from "lucide-react"
import Link from "next/link"

interface Invoice {
  id: string
  invoiceNo: string
  type: string
  status: string
  date: string
  dueDate?: string
  totalAmount: number
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
  const { toast } = useToast()
  
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

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
        // The /api/e-donusum/invoices endpoint already includes `payments: [{ amount }]`
        // for each invoice, so no per-invoice payment fetch is needed.
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
              <CardTitle>Faturalar</CardTitle>
              <CardDescription>Tüm faturalarınızı görüntüleyin ve yönetin</CardDescription>
            </div>
            <Button onClick={handleCreateInvoice}>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Fatura
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : listError ? (
            <div className="space-y-2 py-8 text-center text-sm text-destructive">{listError}</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz fatura bulunmuyor
            </div>
          ) : (
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
                {invoices.map((invoice) => {
                  const paymentStatus = getPaymentStatus(invoice)
                  const totalPaid = invoice.payments?.reduce(
                    (sum, p) => sum + Number(p.amount),
                    0
                  ) || 0
                  const remaining = Number(invoice.totalAmount) - totalPaid

                  return (
                    <TableRow key={invoice.id}>
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
                      <TableCell>
                        <div className="flex gap-2">
                          <Link href={`/faturalar/${invoice.id}/onizleme?company=${companyId}`}>
                            <Button variant="outline" size="sm">
                              <FileText className="h-4 w-4 mr-1" />
                              Önizleme
                            </Button>
                          </Link>
                          <Link href={`/faturalar/${invoice.id}/odemeler?company=${companyId}`}>
                            <Button variant="outline" size="sm">
                              <Eye className="h-4 w-4 mr-1" />
                              Ödemeler
                            </Button>
                          </Link>
                          {invoice.status === "DRAFT" && (
                            <Link
                              href={`/e-donusum/${invoice.id}/duzenle?company=${encodeURIComponent(companyId)}&from=${encodeURIComponent("/faturalar")}`}
                            >
                              <Button variant="outline" size="sm">
                                <Pencil className="h-4 w-4 mr-1" />
                                Düzenle
                              </Button>
                            </Link>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

