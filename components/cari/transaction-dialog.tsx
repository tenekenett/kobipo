"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { Printer, Scale, Wallet } from "lucide-react"
import { toDateInput } from "@/lib/format"
import { BAKIYE_KAPAMA_LABEL, BAKIYE_KAPAMA_METHOD } from "@/lib/cari/bakiye-kapama"
import { acikToplam, odemeDagit } from "@/lib/cari/odeme-dagit"

type FinancialAccount = {
  id: string
  name: string
  bankName?: string
}

type OpenInvoice = {
  id: string
  invoiceNo: string
  date?: string
  openAmount: number
}

// WRITE_OFF = Bakiye Kapama / İskonto: kasa/banka hareketi YOK, yalnız seçilen
// faturanın açık tutarı ve cari bakiye kapanır (lib/cari/bakiye-kapama.ts).
// Faturaya bağlı olduğu için yalnız cari bağlamında (customerId/supplierId) sunulur.
type Method = "CASH_BANK" | "CHECK" | "NOTE" | typeof BAKIYE_KAPAMA_METHOD

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

const initialDate = () => toDateInput(new Date())

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
  // Seçili faturalar (birden çok). Tutar seçime ESKİDEN YENİYE dağıtılır
  // (lib/cari/odeme-dagit.ts). Çek/senette bağ bilgi amaçlıdır (bakiye çekin
  // kendisinden düşer) ama yine çoklu yazılır — makbuz ve detay hepsini gösterir.
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([])
  const [method, setMethod] = useState<Method>("CASH_BANK")
  const [formData, setFormData] = useState(() => ({ ...emptyForm(), type: lockedType ?? "INCOME" }))

  useEffect(() => {
    if (!open) return
    setFormData({ ...emptyForm(), type: lockedType ?? "INCOME" })
    setSelectedInvoiceIds([])
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
  const isWriteOff = method === BAKIYE_KAPAMA_METHOD
  const hasParty = Boolean(customerId || supplierId)
  // Kapama açık faturaya işlenir; cari yoksa ya da açık faturası yoksa kaydedilemez.
  const writeOffBlocked = isWriteOff && (!hasParty || openInvoices.length === 0)
  const writeOffNeedsInvoice = isWriteOff && selectedInvoiceIds.length === 0

  // Seçim ve dağıtım önizlemesi — sunucuyla AYNI kural.
  const selectedInvoices = useMemo(
    () => openInvoices.filter((inv) => selectedInvoiceIds.includes(inv.id)),
    [openInvoices, selectedInvoiceIds],
  )
  const selectedOpenTotal = useMemo(() => acikToplam(selectedInvoices), [selectedInvoices])
  const allOpenTotal = useMemo(() => acikToplam(openInvoices), [openInvoices])
  const allSelected = openInvoices.length > 0 && selectedInvoiceIds.length === openInvoices.length
  const dagitim = useMemo(
    () => odemeDagit(Number(formData.amount) || 0, selectedInvoices),
    [formData.amount, selectedInvoices],
  )
  // Kapamanın avansı olmaz: tutar seçili açık toplamı aşamaz.
  const writeOffExceeds = isWriteOff && dagitim.remainder > 0

  // Seçim değişince tutar seçili açık toplama kurulur; kullanıcı sonra değiştirebilir.
  const applySelection = (ids: string[]) => {
    setSelectedInvoiceIds(ids)
    const total = acikToplam(openInvoices.filter((inv) => ids.includes(inv.id)))
    set({ amount: total > 0 ? String(total) : "" })
  }
  const toggleInvoice = (id: string) => {
    applySelection(
      selectedInvoiceIds.includes(id)
        ? selectedInvoiceIds.filter((x) => x !== id)
        : [...selectedInvoiceIds, id],
    )
  }
  const toggleAll = () => applySelection(allSelected ? [] : openInvoices.map((inv) => inv.id))

  // Tek açık fatura varsa kapama için onu seç ve açık tutarını öner; iki
  // tıklamayı bire indirir, birden çok faturada seçim kullanıcıya kalır.
  useEffect(() => {
    if (!isWriteOff || selectedInvoiceIds.length > 0 || openInvoices.length !== 1) return
    const only = openInvoices[0]
    setSelectedInvoiceIds([only.id])
    setFormData((prev) => ({ ...prev, amount: String(only.openAmount) }))
  }, [isWriteOff, selectedInvoiceIds.length, openInvoices])

  // Çek/senet kaydedildiği anda müşteriye verilecek makbuz. Kasa/banka tahsilatının
  // makbuzu hareket detayından alınıyor; çek/senet Transaction yazmadığı için oraya
  // düşmez, bu yüzden makbuz kaydın hemen ardından burada sunulur.
  const downloadMakbuz = async (
    id: string,
    instrumentType: "CHECK" | "PROMISSORY_NOTE",
    // Evrak no ÇAĞRI ANINDA yakalanır: toast diyalog kapandıktan sonra tıklanıyor,
    // o sırada `formData` sıfırlanmış olabilir.
    evrakNo: string,
  ) => {
    try {
      const res = await fetch(`/api/cek-senet/${id}/makbuz?type=${instrumentType}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Makbuz üretilemedi")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${instrumentType === "CHECK" ? "Cek" : "Senet"}-Makbuzu-${evrakNo}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({
        title: "Makbuz oluşturulamadı",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      let response: Response
      if (isWriteOff) {
        if (writeOffNeedsInvoice) throw new Error("Kapatılacak faturaları seçin")
        if (writeOffExceeds) throw new Error("Tutar seçili faturaların açık toplamını aşıyor")
        response = await fetch("/api/cari/bakiye-kapama", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            customerId: customerId || null,
            supplierId: supplierId || null,
            invoiceIds: selectedInvoiceIds,
            amount: Number(formData.amount),
            date: formData.date,
            reference: formData.reference || null,
            notes: formData.description || null,
          }),
        })
      } else if (method === "CASH_BANK") {
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
            invoiceIds: selectedInvoiceIds,
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
            invoiceIds: selectedInvoiceIds,
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

      const instrument =
        method === "CHECK" ? "Çek" : method === "NOTE" ? "Senet" : isWriteOff ? BAKIYE_KAPAMA_LABEL : transactionLabel
      if (method === "CASH_BANK" || isWriteOff) {
        toast({ title: "Başarılı", description: `${instrument} kaydedildi` })
      } else {
        const created = await response.json().catch(() => null)
        const instrumentType = method === "CHECK" ? "CHECK" : "PROMISSORY_NOTE"
        const evrakNo = method === "CHECK" ? formData.checkNo : formData.noteNo
        toast({
          title: "Başarılı",
          description: `${instrument} kaydedildi`,
          action: created?.id ? (
            <ToastAction altText="Makbuz indir" onClick={() => downloadMakbuz(created.id, instrumentType, evrakNo)}>
              <Printer className="mr-1 h-3.5 w-3.5" />
              Makbuz
            </ToastAction>
          ) : undefined,
        })
      }
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
                {hasParty && <SelectItem value={BAKIYE_KAPAMA_METHOD}>{BAKIYE_KAPAMA_LABEL}</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {/* Bakiye kapama / iskonto: kasa yok, fatura ZORUNLU */}
          {isWriteOff &&
            (openInvoices.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
                <Scale className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-amber-900 dark:text-amber-200">
                  Bu carinin açık faturası yok. Bakiye kapama / iskonto yalnız açık bir faturaya
                  işlenir; avans ya da açılış bakiyesi bu yolla kapatılamaz.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30">
                <Scale className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                <p className="text-rose-900 dark:text-rose-200">
                  Kasa/banka hareketi oluşmaz. Seçilen faturanın açık tutarı ve cari bakiye bu
                  tutar kadar kapanır; kayıt ekstrede ve raporlarda ayrı gösterilir.
                </p>
              </div>
            ))}

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
              <div className="flex items-center justify-between gap-2">
                <Label>{isWriteOff ? "Kapatılacak Faturalar *" : "Faturalar (opsiyonel)"}</Label>
                {/* Tüm açık bakiyeyi tek tıkla: hepsini seçer, tutarı açık toplama kurar. */}
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" className="rounded" checked={allSelected} onChange={toggleAll} />
                  Tüm açık bakiyeyi kapat ({formatTRY(allOpenTotal)})
                </label>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {openInvoices.map((inv) => {
                  const checked = selectedInvoiceIds.includes(inv.id)
                  const pay = dagitim.allocations.find((a) => a.invoiceId === inv.id)
                  return (
                    <label
                      key={inv.id}
                      className={`flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50 ${
                        checked ? "bg-muted/40" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={checked}
                        onChange={() => toggleInvoice(inv.id)}
                      />
                      <span className="flex-1 truncate font-mono text-xs">{inv.invoiceNo}</span>
                      {inv.date && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(inv.date).toLocaleDateString("tr-TR")}
                        </span>
                      )}
                      <span className="whitespace-nowrap tabular-nums">
                        {formatTRY(inv.openAmount)}
                        {/* Dağıtım önizlemesi: bu faturaya düşen pay açık tutardan azsa. */}
                        {checked && pay && pay.amount < inv.openAmount - 0.005 && (
                          <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">
                            → {formatTRY(pay.amount)}
                          </span>
                        )}
                        {checked && !pay && Number(formData.amount) > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">→ 0</span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedInvoiceIds.length > 0 && (
                  <>Seçili açık toplam: {formatTRY(selectedOpenTotal)}. </>
                )}
                {isWriteOff
                  ? "Tutar seçili faturalara eskiden yeniye dağıtılır; açık toplamı aşamaz."
                  : "Tutar seçili faturalara eskiden yeniye dağıtılır; fazlası avans olarak kalır."}
              </p>
              {writeOffExceeds && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Tutar seçili faturaların açık toplamını {formatTRY(dagitim.remainder)} aşıyor.
                </p>
              )}
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

          {method === "CASH_BANK" || isWriteOff ? (
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
            <Label>{method === "CASH_BANK" || isWriteOff ? "Açıklama" : "Notlar"}</Label>
            <Input
              value={formData.description}
              onChange={(event) => set({ description: event.target.value })}
              placeholder={
                method === "CASH_BANK"
                  ? "İşlem açıklaması"
                  : isWriteOff
                    ? "Ör. Kuruş farkı, pazarlık iskontosu"
                    : "Çek/senet notu"
              }
            />
          </div>

          {(method === "CASH_BANK" || isWriteOff) && (
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
            <Button
              type="submit"
              disabled={isSubmitting || accountMissing || writeOffBlocked || writeOffNeedsInvoice || writeOffExceeds}
            >
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
