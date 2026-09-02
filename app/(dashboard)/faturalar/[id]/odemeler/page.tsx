"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter, useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { WriteAction } from "@/components/dashboard/write-guard"
import { PAYMENT_LINKS_ENABLED } from "@/lib/faturalar/payment-links"
import { Plus, Trash2, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface Invoice {
  id: string
  invoiceNo: string
  type: string
  totalAmount: number
  date: string
  dueDate?: string
  customer?: { name: string }
  supplier?: { name: string }
}

interface Payment {
  id: string
  amount: number
  paymentDate: string
  paymentMethod: string
  reference?: string
  notes?: string
  account?: {
    id: string
    name: string
    type: string
  }
}

interface FinancialAccount {
  id: string
  name: string
  type: string
}

interface PaymentLink {
  id: string
  token: string
  amount: number
  status: string
  expiresAt?: string
  createdAt: string
  paymentUrl?: string
}

export default function FaturaOdemelerPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const invoiceId = params.id as string
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // Bu ekrana fatura listesi dışından da gelinir (ör. fiş detayı). Çağıran taraf
  // `?return=` ile dönüş yolunu verir; yoksa belge tipine göre fatura listesine döner.
  // Güvenlik: yalnızca uygulama içi mutlak yol kabul edilir (açık yönlendirme olmasın).
  const returnParam = searchParams.get("return")
  const returnTo =
    returnParam && returnParam.startsWith("/") && !returnParam.startsWith("//") ? returnParam : null

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [paymentLinks, setPaymentLinks] = useState<PaymentLink[]>([])
  const [linkAmount, setLinkAmount] = useState("")
  const [linkExpiresAt, setLinkExpiresAt] = useState("")

  const [formData, setFormData] = useState({
    amount: "",
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "CASH",
    accountId: "",
    reference: "",
    notes: "",
  })

  useEffect(() => {
    if (invoiceId && companyId) {
      fetchInvoice()
      fetchPayments()
      fetchAccounts()
      if (PAYMENT_LINKS_ENABLED) fetchPaymentLinks()
    }
  }, [invoiceId, companyId])

  const fetchInvoice = async () => {
    if (!companyId || !invoiceId) return
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoice(data)
      }
    } catch (error) {
      console.error("Error fetching invoice:", error)
    }
  }

  const fetchPayments = async () => {
    if (!companyId || !invoiceId) return
    try {
      const response = await fetch(
        `/api/faturalar/odemeler?companyId=${companyId}&invoiceId=${invoiceId}`
      )
      if (response.ok) {
        const data = await response.json()
        setPayments(data)
      }
    } catch (error) {
      console.error("Error fetching payments:", error)
    }
  }

  const fetchAccounts = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/finans/accounts?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setAccounts(data)
      }
    } catch (error) {
      console.error("Error fetching accounts:", error)
    }
  }

  const fetchPaymentLinks = async () => {
    if (!invoiceId) return
    const response = await fetch(`/api/faturalar/${invoiceId}/payment-link`)
    if (response.ok) {
      const data = await response.json()
      setPaymentLinks(data)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !invoiceId) return

    setIsLoading(true)
    try {
      const response = await fetch("/api/faturalar/odemeler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          companyId,
          ...formData,
        }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Ödeme kaydı oluşturuldu",
        })
        setIsModalOpen(false)
        setFormData({
          amount: "",
          paymentDate: new Date().toISOString().split("T")[0],
          paymentMethod: "CASH",
          accountId: "",
          reference: "",
          notes: "",
        })
        fetchPayments()
        fetchInvoice()
      } else {
        const error = await response.json()
        toast({
          title: "Hata",
          description: error.error || "Ödeme kaydı oluşturulamadı",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (paymentId: string) => {
    if (!(await confirm({ title: "Ödemeyi sil", description: "Bu ödemeyi silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return

    try {
      const response = await fetch(`/api/faturalar/odemeler/${paymentId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Ödeme kaydı silindi",
        })
        fetchPayments()
        fetchInvoice()
      } else {
        toast({
          title: "Hata",
          description: "Ödeme kaydı silinemedi",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const createPaymentLink = async () => {
    const response = await fetch(`/api/faturalar/${invoiceId}/payment-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: linkAmount ? Number(linkAmount) : undefined,
        expiresAt: linkExpiresAt ? new Date(linkExpiresAt).toISOString() : undefined,
      }),
    })
    if (response.ok) {
      const data = await response.json()
      if (data.paymentUrl) {
        navigator.clipboard.writeText(`${window.location.origin}${data.paymentUrl}`).catch(() => {})
      }
      setLinkAmount("")
      setLinkExpiresAt("")
      fetchPaymentLinks()
      toast({
        title: "Başarılı",
        description: "Ödeme linki oluşturuldu ve panoya kopyalandı",
      })
    } else {
      const data = await response.json()
      toast({
        title: "Hata",
        description: data.error || "Ödeme linki oluşturulamadı",
        variant: "destructive",
      })
    }
  }

  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const remaining = invoice ? Number(invoice.totalAmount) - totalPaid : 0

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("tr-TR")
  }

  const getPaymentMethodLabel = (method: string) => {
    const methods: Record<string, string> = {
      CASH: "Nakit",
      BANK_TRANSFER: "Banka Transferi",
      CHECK: "Çek",
      CREDIT_CARD: "Kredi Kartı",
      MEAL_CARD: "Yemek Kartı",
      OTHER: "Diğer",
    }
    return methods[method] || method
  }

  if (!invoice) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Yükleniyor...</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Link
                  href={
                    returnTo ??
                    (invoice.type === "PURCHASE"
                      ? `/alis/fatura?company=${companyId || ""}`
                      : `/satis/fatura?company=${companyId || ""}`)
                  }
                >
                  <Button variant="ghost" size="sm">
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Geri
                  </Button>
                </Link>
              </div>
              <CardTitle>Fatura Ödemeleri</CardTitle>
              <CardDescription>
                Fatura No: {invoice.invoiceNo} - {invoice.customer?.name || invoice.supplier?.name}
              </CardDescription>
            </div>
            <WriteAction>
              <Button onClick={() => setIsModalOpen(true)} disabled={remaining <= 0}>
                <Plus className="mr-2 h-4 w-4" />
                Yeni Ödeme
              </Button>
            </WriteAction>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Toplam Tutar</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(Number(invoice.totalAmount))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ödenen</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(totalPaid)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Kalan</CardDescription>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${remaining > 0 ? "text-red-600" : "text-green-600"}`}>
                  {formatCurrency(remaining)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Tutar</TableHead>
                <TableHead>Ödeme Yöntemi</TableHead>
                <TableHead>Hesap</TableHead>
                <TableHead>Referans</TableHead>
                <TableHead>Notlar</TableHead>
                <TableHead>İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Henüz ödeme kaydı bulunmuyor
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(Number(payment.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {getPaymentMethodLabel(payment.paymentMethod)}
                      </Badge>
                    </TableCell>
                    <TableCell>{payment.account?.name || "-"}</TableCell>
                    <TableCell>{payment.reference || "-"}</TableCell>
                    <TableCell>{payment.notes || "-"}</TableCell>
                    <TableCell>
                      <WriteAction>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(payment.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </WriteAction>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {PAYMENT_LINKS_ENABLED && (
        <Card>
          <CardHeader>
            <CardTitle>Online Tahsilat Linkleri</CardTitle>
            <CardDescription>
              Link oluşturup müşteriye gönderin. Ödeme sonrası kayıt otomatik oluşur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <WriteAction>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Tutar (boş bırakılırsa kalan)"
                  value={linkAmount}
                  onChange={(e) => setLinkAmount(e.target.value)}
                />
                <Input
                  type="datetime-local"
                  value={linkExpiresAt}
                  onChange={(e) => setLinkExpiresAt(e.target.value)}
                />
                <Button onClick={createPaymentLink} disabled={remaining <= 0}>
                  Ödeme Linki Oluştur
                </Button>
              </div>
            </WriteAction>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Tutar</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Son Kullanım</TableHead>
                  <TableHead>İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentLinks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Link bulunamadı
                    </TableCell>
                  </TableRow>
                ) : (
                  paymentLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell className="font-mono text-xs">{link.token.slice(0, 12)}...</TableCell>
                      <TableCell>{formatCurrency(Number(link.amount))}</TableCell>
                      <TableCell>{link.status}</TableCell>
                      <TableCell>{link.expiresAt ? formatDate(link.expiresAt) : "-"}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigator.clipboard.writeText(`${window.location.origin}/pay/${link.token}`)
                          }
                        >
                          URL Kopyala
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Yeni Ödeme</DialogTitle>
            <DialogDescription>
              Fatura için ödeme kaydı oluşturun. Kalan tutar: {formatCurrency(remaining)}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Tutar *</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    required
                    max={remaining}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paymentDate">Ödeme Tarihi *</Label>
                  <Input
                    id="paymentDate"
                    type="date"
                    value={formData.paymentDate}
                    onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="paymentMethod">Ödeme Yöntemi *</Label>
                  <Select
                    value={formData.paymentMethod}
                    onValueChange={(value) =>
                      setFormData({ ...formData, paymentMethod: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Nakit</SelectItem>
                      <SelectItem value="BANK_TRANSFER">Banka Transferi</SelectItem>
                      <SelectItem value="CHECK">Çek</SelectItem>
                      <SelectItem value="CREDIT_CARD">Kredi Kartı</SelectItem>
                      <SelectItem value="OTHER">Diğer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountId">Hesap</Label>
                  <Select
                    value={formData.accountId}
                    onValueChange={(value) =>
                      setFormData({ ...formData, accountId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Hesap seçiniz" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name} ({account.type === "CASH" ? "Kasa" : "Banka"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reference">Referans</Label>
                <Input
                  id="reference"
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  placeholder="Makbuz no, işlem no vb."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notlar</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Ödeme ile ilgili notlar"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
              >
                İptal
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

