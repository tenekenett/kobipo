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

type Method = "CASH_BANK" | "CHECK" | "NOTE"

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

const emptyForm = () => ({
  accountId: "",
  type: "INCOME" as "INCOME" | "EXPENSE",
  amount: "",
  date: initialDate(),
  description: "",
  reference: "",
  // Çek/Senet alanları
  checkNo: "",
  bankName: "",
  branchName: "",
  accountNo: "",
  noteNo: "",
  issueDate: initialDate(),
  dueDate: initialDate(),
})

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
  const [method, setMethod] = useState<Method>("CASH_BANK")
  const [formData, setFormData] = useState(() => ({ ...emptyForm(), type: lockedType ?? "INCOME" }))

  useEffect(() => {
    if (!open) return
    setFormData({ ...emptyForm(), type: lockedType ?? "INCOME" })
    setSelectedInvoiceId(NO_INVOICE)
    setMethod("CASH_BANK")
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

  const effectiveType = lockedType ?? formData.type
  // Alınan (RECEIVED) çek/senet alacağı kapatır; verilen (GIVEN) borcu kapatır.
  const direction = effectiveType === "EXPENSE" ? "GIVEN" : "RECEIVED"
  const needsAccount = method === "CASH_BANK"
  const accountMissing = needsAccount && accounts.length === 0

  const set = (patch: Partial<ReturnType<typeof emptyForm>>) =>
    setFormData((prev) => ({ ...prev, ...patch }))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      let response: Response
      if (method === "CASH_BANK") {
        response = await fetch("/api/finans/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            accountId: formData.accountId,
            type: effectiveType,
            amount: Number(formData.amount),
            date: formData.date,
            description: formData.description,
            reference: formData.reference,
            customerId: customerId || null,
            supplierId: supplierId || null,
            invoiceId: selectedInvoiceId !== NO_INVOICE ? selectedInvoiceId : null,
          }),
        })
      } else {
        response = await fetch("/api/cek-senet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: method === "CHECK" ? "CHECK" : "PROMISSORY_NOTE",
            companyId,
            amount: Number(formData.amount),
            issueDate: formData.issueDate,
            dueDate: formData.dueDate,
            direction,
            customerId: customerId || null,
            supplierId: supplierId || null,
            invoiceId: selectedInvoiceId !== NO_INVOICE ? selectedInvoiceId : null,
            notes: formData.description || null,
            ...(method === "CHECK"
              ? {
                  checkNo: formData.checkNo,
                  bankName: formData.bankName,
                  branchName: formData.branchName || null,
                  accountNo: formData.accountNo || null,
                }
              : { noteNo: formData.noteNo }),
          }),
        })
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "İşlem oluşturulamadı")
      }

      const instrument = method === "CHECK" ? "Çek" : method === "NOTE" ? "Senet" : transactionLabel
      toast({ title: "Başarılı", description: `${instrument} kaydedildi` })
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tahsilat/Ödeme yöntemi: Nakit-Banka, Çek veya Senet */}
          <div className="space-y-2">
            <Label>{transactionLabel} Yöntemi *</Label>
            <Select value={method} onValueChange={(value) => setMethod(value as Method)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH_BANK">Nakit / Banka</SelectItem>
                <SelectItem value="CHECK">Çek</SelectItem>
                <SelectItem value="NOTE">Senet</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Nakit/Banka: hesap seçimi (hesap yoksa uyarı) */}
          {method === "CASH_BANK" &&
            (accountMissing ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
                <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-2">
                  <p className="text-amber-900 dark:text-amber-200">
                    Henüz kasa/banka hesabı yok. Nakit/Banka {transactionLabel.toLocaleLowerCase("tr-TR")}ı için
                    önce bir hesap ekleyin ya da yöntem olarak Çek/Senet seçin.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false)
                      router.push(`/finans/kanallar?company=${companyId}`)
                    }}
                  >
                    Finans Kanalı Ekle
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Hesap *</Label>
                <Select
                  value={formData.accountId}
                  onValueChange={(value) => set({ accountId: value })}
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
            ))}

          {/* Çek alanları */}
          {method === "CHECK" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Çek No *</Label>
                <Input value={formData.checkNo} onChange={(e) => set({ checkNo: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Banka *</Label>
                <Input value={formData.bankName} onChange={(e) => set({ bankName: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Şube</Label>
                <Input value={formData.branchName} onChange={(e) => set({ branchName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Hesap No</Label>
                <Input value={formData.accountNo} onChange={(e) => set({ accountNo: e.target.value })} />
              </div>
            </div>
          )}

          {/* Senet alanları */}
          {method === "NOTE" && (
            <div className="space-y-2">
              <Label>Senet No *</Label>
              <Input value={formData.noteNo} onChange={(e) => set({ noteNo: e.target.value })} required />
            </div>
          )}

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
                    set({ amount: String(inv.openAmount) })
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

          {!lockedType && method === "CASH_BANK" && (
            <div className="space-y-2">
              <Label>İşlem Tipi *</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => set({ type: value as "INCOME" | "EXPENSE" })}
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
              onChange={(event) => set({ amount: event.target.value })}
              required
            />
          </div>

          {method === "CASH_BANK" ? (
            <div className="space-y-2">
              <Label>Tarih *</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(event) => set({ date: event.target.value })}
                required
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Düzenleme Tarihi *</Label>
                <Input
                  type="date"
                  value={formData.issueDate}
                  onChange={(event) => set({ issueDate: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Vade Tarihi *</Label>
                <Input
                  type="date"
                  value={formData.dueDate}
                  onChange={(event) => set({ dueDate: event.target.value })}
                  required
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{method === "CASH_BANK" ? "Açıklama" : "Notlar"}</Label>
            <Input
              value={formData.description}
              onChange={(event) => set({ description: event.target.value })}
              placeholder={method === "CASH_BANK" ? "İşlem açıklaması" : "Çek/senet notu"}
            />
          </div>

          {method === "CASH_BANK" && (
            <div className="space-y-2">
              <Label>Referans</Label>
              <Input
                value={formData.reference}
                onChange={(event) => set({ reference: event.target.value })}
                placeholder="Referans no"
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting || accountMissing}>
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
