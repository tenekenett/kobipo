"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { Wallet } from "lucide-react"

type FinancialAccount = {
  id: string
  name: string
  bankName?: string
}

type OpenInvoice = {
  id: string
  invoiceNo: string
  openAmount: number
}

const NO_INVOICE = "none"

const formatTRY = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value)

type TransactionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  title: string
  description: string
  lockedType?: "INCOME" | "EXPENSE"
  customerId?: string | null
  supplierId?: string | null
  accounts: FinancialAccount[]
  onSuccess?: () => Promise<void> | void
}

const initialDate = () => new Date().toISOString().split("T")[0]

export function TransactionDialog({
  open,
  onOpenChange,
  companyId,
  title,
  description,
  lockedType,
  customerId,
  supplierId,
  accounts,
  onSuccess,
}: TransactionDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([])
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(NO_INVOICE)
  const [formData, setFormData] = useState({
    accountId: "",
    type: lockedType ?? "INCOME",
    amount: "",
    date: initialDate(),
    description: "",
    reference: "",
  })

  useEffect(() => {
    if (!open) return
    setFormData({
      accountId: "",
      type: lockedType ?? "INCOME",
      amount: "",
      date: initialDate(),
      description: "",
      reference: "",
    })
    setSelectedInvoiceId(NO_INVOICE)
  }, [open, lockedType])

  // Cari bağlamında açıldıysa carinin açık faturalarını getir (tahsilatı faturaya
  // bağlamak için). Cari yoksa boş kalır ve eşleştirme alanı gösterilmez.
  useEffect(() => {
    if (!open) return
    const party = customerId
      ? `customerId=${customerId}`
      : supplierId
        ? `supplierId=${supplierId}`
        : null
    if (!party) {
      setOpenInvoices([])
      return
    }
    let cancelled = false
    fetch(`/api/cari/open-invoices?companyId=${companyId}&${party}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setOpenInvoices(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setOpenInvoices([])
      })
    return () => {
      cancelled = true
    }
  }, [open, companyId, customerId, supplierId])

  const transactionLabel = useMemo(() => {
    if (lockedType === "INCOME") return "Tahsilat"
    if (lockedType === "EXPENSE") return "Ödeme"
    return "Hareket"
  }, [lockedType])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const response = await fetch("/api/finans/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          companyId,
          amount: Number(formData.amount),
          type: lockedType ?? formData.type,
          customerId: customerId || null,
          supplierId: supplierId || null,
          invoiceId: selectedInvoiceId !== NO_INVOICE ? selectedInvoiceId : null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "İşlem oluşturulamadı")
      }

      toast({
        title: "Başarılı",
        description: `${transactionLabel} kaydedildi`,
      })
      onOpenChange(false)
      await onSuccess?.()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (open && accounts.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Wallet className="h-6 w-6" />
            </span>
            <div>
              <p className="font-medium">Henüz kasa veya banka hesabı yok</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {transactionLabel} kaydı oluşturabilmek için önce Finans Kanalları sayfasından
                bir kasa veya banka hesabı eklemelisiniz.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false)
                router.push(`/finans/kanallar?company=${companyId}`)
              }}
            >
              Finans Kanalı Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Hesap *</Label>
            <Select
              value={formData.accountId}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, accountId: value }))}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Hesap seçin" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} {account.bankName ? `(${account.bankName})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {openInvoices.length > 0 && (
            <div className="space-y-2">
              <Label>Fatura (opsiyonel)</Label>
              <Select
                value={selectedInvoiceId}
                onValueChange={(value) => {
                  setSelectedInvoiceId(value)
                  const inv = openInvoices.find((i) => i.id === value)
                  if (inv) {
                    // Seçilen faturanın açık tutarını öner (kullanıcı değiştirebilir).
                    setFormData((prev) => ({ ...prev, amount: String(inv.openAmount) }))
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INVOICE}>Faturaya bağlama (avans)</SelectItem>
                  {openInvoices.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoiceNo} · Açık: {formatTRY(inv.openAmount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Bir fatura seçerseniz tutarın açık kadarı o faturaya işlenir; fazlası avans olarak kalır.
              </p>
            </div>
          )}

          {!lockedType && (
            <div className="space-y-2">
              <Label>İşlem Tipi *</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, type: value as "INCOME" | "EXPENSE" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INCOME">Gelir</SelectItem>
                  <SelectItem value="EXPENSE">Gider</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Tutar *</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={formData.amount}
              onChange={(event) => setFormData((prev) => ({ ...prev, amount: event.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Tarih *</Label>
            <Input
              type="date"
              value={formData.date}
              onChange={(event) => setFormData((prev) => ({ ...prev, date: event.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Açıklama</Label>
            <Input
              value={formData.description}
              onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="İşlem açıklaması"
            />
          </div>

          <div className="space-y-2">
            <Label>Referans</Label>
            <Input
              value={formData.reference}
              onChange={(event) => setFormData((prev) => ({ ...prev, reference: event.target.value }))}
              placeholder="Referans no"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
