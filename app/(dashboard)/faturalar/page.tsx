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
import { Eye, Plus, FileText } from "lucide-react"
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
    try {
      const response = await fetch(`/api/e-donusum/invoices?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        // Ödeme bilgilerini de al
        const invoicesWithPayments = await Promise.all(
          data.map(async (invoice: Invoice) => {
            const paymentsRes = await fetch(
              `/api/faturalar/odemeler?companyId=${companyId}&invoiceId=${invoice.id}`
            )
            if (paymentsRes.ok) {
              const payments = await paymentsRes.json()
              return { ...invoice, payments }
            }
            return invoice
          })
        )
        setInvoices(invoicesWithPayments)
      }
    } catch (error) {
      console.error("Error fetching invoices:", error)
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
    const target = company?.isEDonusumEnabled
      ? `/e-donusum?company=${companyId}`
      : `/e-donusum?company=${companyId}&manual=1`
    router.push(target)
  }

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
                          {invoice.type === "SALES" ? "Satış" : "Alış"}
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

