"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
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
import { Plus, Send, FileText, Eye, Pencil } from "lucide-react"
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

interface CompanySettings {
  id: string
  isEDonusumEnabled?: boolean
}

export default function EDönüşümPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)

  /** Eski paylaşılan linkler: ?edit= ve ?manual=1 */
  useEffect(() => {
    if (!companyId) return
    const edit = searchParams.get("edit")
    if (edit) {
      router.replace(`/e-donusum/${edit}/duzenle?company=${encodeURIComponent(companyId)}`)
      return
    }
    if (searchParams.get("manual") === "1") {
      router.replace(`/e-donusum/yeni?company=${encodeURIComponent(companyId)}&manual=1`)
    }
  }, [companyId, searchParams, router])

  useEffect(() => {
    if (companyId) {
      fetchInvoices()
      fetchCompanySettings()
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

  const fetchCompanySettings = async () => {
    if (!companyId) return
    try {
      const response = await fetch("/api/companies")
      if (!response.ok) return
      const companies = (await response.json()) as CompanySettings[]
      setCompanySettings(companies.find((company) => company.id === companyId) || null)
    } catch (error) {
      console.error("Error fetching company settings:", error)
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

  const legacyEdit = searchParams.get("edit")
  const legacyManual = searchParams.get("manual") === "1"
  if (legacyEdit || legacyManual) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Yönlendiriliyor…</p>
      </div>
    )
  }

  const goNewInvoice = () => {
    router.push(`/e-donusum/yeni?company=${encodeURIComponent(companyId)}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">E-Dönüşüm</h1>
          <p className="text-muted-foreground">E-Fatura ve E-Arşiv fatura yönetimi</p>
        </div>
        <Button onClick={goNewInvoice}>
          <Plus className="mr-2 h-4 w-4" />
          Yeni Fatura
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Faturalar</CardTitle>
          <CardDescription>Toplam {invoices.length} fatura</CardDescription>
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
                  <TableCell colSpan={8} className="py-8 text-center">
                    <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Henüz fatura oluşturulmamış</p>
                    <Button variant="link" onClick={goNewInvoice}>
                      İlk faturanızı oluşturun
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                    <TableCell>
                      {invoice.type === "SALES"
                        ? "Satış"
                        : invoice.type === "PURCHASE"
                          ? "Alış"
                          : invoice.type === "RETURN"
                            ? "İade"
                            : invoice.type}
                    </TableCell>
                    <TableCell>
                      {invoice.invoiceType === "E_INVOICE"
                        ? "E-Fatura"
                        : invoice.invoiceType === "E_ARCHIVE"
                          ? "E-Arsiv"
                          : "Manuel"}
                    </TableCell>
                    <TableCell>{new Date(invoice.date).toLocaleDateString("tr-TR")}</TableCell>
                    <TableCell>{invoice.customer?.name || invoice.supplier?.name || "-"}</TableCell>
                    <TableCell className="text-right">
                      {new Intl.NumberFormat("tr-TR", {
                        style: "currency",
                        currency: "TRY",
                      }).format(Number(invoice.totalAmount))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          invoice.status === "SENT"
                            ? "bg-green-100 text-green-800"
                            : invoice.status === "DRAFT"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {invoice.status === "SENT" ? "Gönderildi" : invoice.status === "DRAFT" ? "Taslak" : invoice.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Link href={`/e-donusum/${invoice.id}?company=${companyId}`}>
                          <Button variant="outline" size="sm">
                            <Eye className="mr-1 h-3 w-3" />
                            Önizle
                          </Button>
                        </Link>
                        {invoice.status === "DRAFT" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              router.push(
                                `/e-donusum/${invoice.id}/duzenle?company=${encodeURIComponent(companyId)}`
                              )
                            }
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            Düzenle
                          </Button>
                        )}
                        {companySettings?.isEDonusumEnabled &&
                          invoice.status === "DRAFT" &&
                          invoice.type === "SALES" &&
                          (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
                            <Button variant="outline" size="sm" onClick={() => handleSendInvoice(invoice.id)} disabled={isLoading}>
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
