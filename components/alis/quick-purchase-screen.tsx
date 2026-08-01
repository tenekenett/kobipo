"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { buildReceiptHtml, currency, type ReceiptData } from "@/lib/fis/receipt-html"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { ProductCombobox, type ComboboxProduct } from "@/components/e-donusum/product-combobox"
import { CounterpartyCombobox } from "@/components/e-donusum/counterparty-combobox"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import {
  useProducts,
  useSuppliers,
  useAccounts,
  useWarehouses,
  useProductCategories,
  useReceiptTemplate,
} from "@/lib/swr/use-company-data"
import { cn } from "@/lib/utils"
import {
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  Printer,
  Receipt,
  Search,
  Share2,
  Split,
  Trash2,
} from "lucide-react"

type CartLine = {
  key: string
  productId: string | null
  description: string
  unit: string
  quantity: number
  unitPrice: number
  vatRate: number
}

type QuickProduct = ComboboxProduct & { category?: string | null }

type PaymentMethod = "CASH" | "CREDIT_CARD" | "BANK_TRANSFER"

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "CASH", label: "Nakit", icon: Banknote },
  { value: "CREDIT_CARD", label: "Kredi Kartı", icon: CreditCard },
  { value: "BANK_TRANSFER", label: "Havale/EFT", icon: Landmark },
]

// Aynı anda açık tutulabilen park edilmiş alış (tedarikçi) sayısı.
const NUM_TICKETS = 5
const ALL_CATEGORIES = "__ALL__"

// Önceki fiyatlar (geçmiş) modalı — /api/stok/products/[id]/prices yanıtı.
type PriceRow = { date: string; cariName: string; price: number }
type PriceHistory = {
  sales: PriceRow[]
  customerSales: PriceRow[]
  purchases: PriceRow[]
  supplierPurchases: PriceRow[]
  quotes: PriceRow[]
}
type PriceTab = "purchases" | "sales"
const EMPTY_PRICE_HISTORY: PriceHistory = {
  sales: [],
  customerSales: [],
  purchases: [],
  supplierPurchases: [],
  quotes: [],
}
const PRICE_TABS: { key: PriceTab; label: string }[] = [
  { key: "purchases", label: "Önceki Alışlar" },
  { key: "sales", label: "Önceki Satışlar" },
]

// note: alış anında girilen kısa fiş notu (fişe basılır). Ticket'ta tutulur ki
// park edilen alışlar arasında geçiş yapınca kaybolmasın.
type Ticket = { cart: CartLine[]; supplierId?: string; tendered: string; note: string }
const emptyTicket = (): Ticket => ({ cart: [], supplierId: undefined, tendered: "", note: "" })

/** type="number" input'larda 0 değerini boş göster — baştaki "0" takılmasın. */
const numInput = (n: number) => (n === 0 ? "" : String(n))

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
// Birim fiyat 6 ondalıkla saklanır (InvoiceItem.unitPrice = Decimal(15,6)). Tutar
// sütunundan geri hesaplarken 2 ondalığa kırparsak hedef tutar tam tutmaz
// (örn. 3 × %20 için 100 → 27,78 → 100,01). 6 ondalık ile round-trip korunur.
const round6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`

function lineTotals(line: CartLine) {
  const net = line.quantity * line.unitPrice
  const vat = net * (line.vatRate / 100)
  return { net, vat, total: net + vat }
}

function cartTotals(cart: CartLine[]) {
  return cart.reduce(
    (acc, line) => {
      const t = lineTotals(line)
      acc.net += t.net
      acc.vat += t.vat
      acc.total += t.total
      return acc
    },
    { net: 0, vat: 0, total: 0 }
  )
}

export function QuickPurchaseScreen() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  const companyId = selectedCompanyId
  const { toast } = useToast()

  // Referans veriler SWR ile önbelleklenir: ekranlar arası paylaşılır ve her
  // mount'ta yeniden çekilmez (aynı anahtar 30 sn içinde dedupe edilir).
  const { products: refProducts } = useProducts(companyId, { isService: false })
  const { suppliers } = useSuppliers(companyId)
  const { accounts } = useAccounts(companyId)
  const { warehouses } = useWarehouses(companyId)
  const { categories: categoryOptions } = useProductCategories(companyId)
  // Fiş tasarımı (Ayarlar > Fiş Tasarımı); kaydedilmemişse varsayılan gelir.
  const { template: receiptTemplate, company: receiptCompany } = useReceiptTemplate(companyId)
  const [warehouseId, setWarehouseId] = useState<string>("")
  // Alış bağlamı: satır/kutucuk birim fiyatı ürünün ALIŞ fiyatından gelsin.
  const products = useMemo<QuickProduct[]>(
    () =>
      refProducts.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        salePrice: p.purchasePrice,
        vatRate: p.vatRate,
        unit: p.unit,
        category: p.category,
      })),
    [refProducts]
  )

  // Park edilen alışlar (Tedarikçi 1..N). Her biri kendi sepeti + tedarikçisi + ödenen tutarı.
  const [tickets, setTickets] = useState<Ticket[]>(() =>
    Array.from({ length: NUM_TICKETS }, emptyTicket)
  )
  const [activeTicket, setActiveTicket] = useState(0)
  const active = tickets[activeTicket]

  const [isCredit, setIsCredit] = useState(false) // Açık Hesap (sonra öde)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH")
  const [accountId, setAccountId] = useState<string>("")
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)
  const [miscAmount, setMiscAmount] = useState("")

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastPurchase, setLastPurchase] = useState<
    { id: string; invoiceNo?: string | null; receipt: ReceiptData } | null
  >(null)
  // Tutar sütununda düzenlenen satır (yazarken alanın kullanıcıyla çakışmasını önler).
  const [totalEdit, setTotalEdit] = useState<{ key: string; value: string } | null>(null)
  // Fiyat sütununda düzenlenen satır — birim fiyat 6 ondalık olabildiğinden (Tutar'dan
  // geri hesaplanınca) alan odak dışıyken 2 ondalıkla gösterilir, yazarken ham girişi korur.
  const [priceEdit, setPriceEdit] = useState<{ key: string; value: string } | null>(null)

  // Parçalı ödeme: yöntem başına tutar.
  const [splitMode, setSplitMode] = useState(false)
  const [split, setSplit] = useState<Record<PaymentMethod, string>>({
    CASH: "",
    CREDIT_CARD: "",
    BANK_TRANSFER: "",
  })

  // Önceki fiyatlar (geçmiş) modalı.
  const [priceModalLine, setPriceModalLine] = useState<CartLine | null>(null)
  const [activePriceTab, setActivePriceTab] = useState<PriceTab>("purchases")
  const [priceHistory, setPriceHistory] = useState<PriceHistory>(EMPTY_PRICE_HISTORY)
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false)

  // Varsayılan depo (Ana) ve kasa/banka hesabı — referans veriler gelince bir kez seç.
  useEffect(() => {
    if (warehouseId || warehouses.length === 0) return
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0]
    if (def) setWarehouseId(def.id)
  }, [warehouses, warehouseId])

  useEffect(() => {
    if (accountId || accounts.length === 0) return
    const firstCash = accounts.find((a) => a.type === "CASH") ?? accounts[0]
    if (firstCash) setAccountId(firstCash.id)
  }, [accounts, accountId])

  // Aktif park (ticket) üzerinde çalışan yardımcılar.
  const patchTicket = useCallback(
    (patch: Partial<Ticket>) => {
      setTickets((prev) => prev.map((t, i) => (i === activeTicket ? { ...t, ...patch } : t)))
    },
    [activeTicket]
  )
  const patchCart = useCallback(
    (updater: (cart: CartLine[]) => CartLine[]) => {
      setTickets((prev) => prev.map((t, i) => (i === activeTicket ? { ...t, cart: updater(t.cart) } : t)))
    },
    [activeTicket]
  )

  const addProductToCart = useCallback(
    (product: ComboboxProduct) => {
      // Alış = stok girişi: depoyu değiştirme, kullanıcının seçtiği (varsayılan Ana) depo kalsın.
      patchCart((cart) => {
        if (product.id) {
          const idx = cart.findIndex((l) => l.productId === product.id)
          if (idx >= 0) {
            const next = [...cart]
            next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 }
            return next
          }
        }
        return [
          ...cart,
          {
            key: uid(),
            productId: product.id || null,
            description: product.name,
            unit: product.unit || "ADET",
            quantity: 1,
            unitPrice: product.salePrice != null ? Number(product.salePrice) : 0,
            vatRate: Number(product.vatRate) || 0,
          },
        ]
      })
    },
    [patchCart]
  )

  const addMisc = useCallback(() => {
    const amt = parseFloat(miscAmount.replace(",", ".")) || 0
    if (amt <= 0) return
    patchCart((cart) => [
      ...cart,
      { key: uid(), productId: null, description: "Muhtelif", unit: "ADET", quantity: 1, unitPrice: amt, vatRate: 20 },
    ])
    setMiscAmount("")
  }, [miscAmount, patchCart])

  const updateLine = useCallback(
    (key: string, patch: Partial<CartLine>) => patchCart((cart) => cart.map((l) => (l.key === key ? { ...l, ...patch } : l))),
    [patchCart]
  )
  // Satır tutarını (KDV dahil) hedefe sabitler; birim fiyatı buna göre geri hesaplar.
  const updateLineTotal = useCallback(
    (key: string, total: number) =>
      patchCart((cart) =>
        cart.map((l) => {
          if (l.key !== key) return l
          const denom = l.quantity * (1 + l.vatRate / 100)
          const unitPrice = denom > 0 ? round6(total / denom) : 0
          return { ...l, unitPrice }
        })
      ),
    [patchCart]
  )
  const removeLine = useCallback(
    (key: string) => patchCart((cart) => cart.filter((l) => l.key !== key)),
    [patchCart]
  )

  const totals = useMemo(() => cartTotals(active.cart), [active.cart])
  const tenderedNum = useMemo(() => parseFloat(active.tendered.replace(",", ".")) || 0, [active.tendered])
  const change = tenderedNum > 0 ? Math.max(0, round2(tenderedNum - totals.total)) : 0

  // Parçalı ödeme türetilmişleri.
  const parseAmount = (v: string) => parseFloat((v || "").replace(",", ".")) || 0
  const splitPaid = useMemo(
    () => round2(parseAmount(split.CASH) + parseAmount(split.CREDIT_CARD) + parseAmount(split.BANK_TRANSFER)),
    [split]
  )
  const splitRemaining = round2(totals.total - splitPaid)
  const paidDisplay = splitMode ? splitPaid : tenderedNum
  const changeDisplay = splitMode ? Math.max(0, round2(splitPaid - totals.total)) : change

  // Ödeme parçalarını doğru hesaba yönlendir: nakit → kasa, kart → POS kanalı
  // (yoksa banka), havale → banka.
  const cashAccountId = useMemo(() => accounts.find((a) => a.type === "CASH")?.id, [accounts])
  const cardAccountId = useMemo(
    () => accounts.find((a) => a.type === "CREDIT_CARD" || a.type === "POS")?.id,
    [accounts],
  )
  const bankAccountId = useMemo(
    () => accounts.find((a) => a.type === "BANK")?.id ?? accounts.find((a) => a.type !== "CASH")?.id,
    [accounts],
  )

  // Kalan tutarı nakit alanına ekle (Tam benzeri kısayol).
  const fillSplitRemainder = () => {
    setSplit((s) => {
      const paid = parseAmount(s.CASH) + parseAmount(s.CREDIT_CARD) + parseAmount(s.BANK_TRANSFER)
      const rem = round2(totals.total - paid)
      if (rem <= 0) return s
      return { ...s, CASH: String(round2(parseAmount(s.CASH) + rem)) }
    })
  }

  // Önceki fiyatlar (geçmiş) modalını aç ve ürünün fiyat geçmişini çek.
  const openPriceHistory = useCallback(
    async (line: CartLine) => {
      if (!line.productId || !companyId) return
      setPriceModalLine(line)
      setActivePriceTab("purchases")
      setPriceHistory(EMPTY_PRICE_HISTORY)
      setPriceHistoryLoading(true)
      try {
        const qs = new URLSearchParams({ companyId })
        if (active.supplierId) qs.set("supplierId", active.supplierId)
        const res = await fetch(`/api/stok/products/${line.productId}/prices?${qs.toString()}`)
        if (res.ok) setPriceHistory(await res.json())
      } catch (error) {
        console.error("Fiyat geçmişi çekilemedi:", error)
      } finally {
        setPriceHistoryLoading(false)
      }
    },
    [companyId, active.supplierId]
  )
  const applyHistoryPrice = (price: number) => {
    if (priceModalLine) updateLine(priceModalLine.key, { unitPrice: price })
    setPriceModalLine(null)
  }

  const productCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category) set.add(p.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"))
  }, [products])

  const quickProducts = useMemo(() => {
    const list = activeCat === ALL_CATEGORIES ? products : products.filter((p) => p.category === activeCat)
    return list.slice(0, 60)
  }, [products, activeCat])

  const setTendered = (v: string) => patchTicket({ tendered: v })
  const addCash = (n: number) => patchTicket({ tendered: String(Math.max(0, round2(tenderedNum + n))) })

  const resetPurchase = useCallback(() => {
    setTickets((prev) => prev.map((t, i) => (i === activeTicket ? emptyTicket() : t)))
    setIsCredit(false)
    setPaymentMethod("CASH")
    setSplit({ CASH: "", CREDIT_CARD: "", BANK_TRANSFER: "" })
  }, [activeTicket])

  const handleComplete = useCallback(async () => {
    if (!companyId) {
      toast({ title: "Hata", description: "Firma seçili değil", variant: "destructive" })
      return
    }
    const tk = tickets[activeTicket]
    const cart = tk.cart
    if (cart.length === 0) {
      toast({ title: "Sepet boş", description: "En az bir ürün ekleyin", variant: "destructive" })
      return
    }
    if (cart.some((l) => l.quantity <= 0)) {
      toast({ title: "Geçersiz miktar", description: "Tüm satırlarda miktar 0'dan büyük olmalı", variant: "destructive" })
      return
    }
    const t = cartTotals(cart)

    setIsSubmitting(true)
    try {
      // Hızlı alış artık FİŞ keser (resmî fatura değil). Stok girişi + ödeme anında
      // işler; fiş "Fişler" listesinden toplu faturaya dönüştürülebilir.
      const invoiceRes = await fetch("/api/e-donusum/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: "PURCHASE",
          invoiceType: "MANUAL",
          isReceipt: true,
          supplierId: tk.supplierId || null,
          warehouseId: warehouseId || undefined,
          date: new Date().toISOString(),
          currency: "TRY",
          notes: tk.note.trim() || undefined,
          items: cart.map((l) => ({
            productId: l.productId || undefined,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
          })),
        }),
      })

      const invoice = await invoiceRes.json().catch(() => ({}))
      if (!invoiceRes.ok) throw new Error(invoice?.error || "Alış fişi oluşturulamadı")

      // Ödeme tutarı, faturanın SUNUCUDA kayıtlı toplamı olmalı: frontend'in
      // yuvarlanmamış t.total'i (ör. birim fiyat geri-hesabından gelen küsurat)
      // sunucunun 2 haneye yuvarladığı totalAmount'ı aşıp ödemeyi reddettirebilir.
      const invoiceTotal = invoice?.totalAmount != null ? Number(invoice.totalAmount) : round2(t.total)

      // Ödeme parçaları: parçalı modda yöntem başına; değilse tek yöntem tüm tutar.
      // Toplam ödeme faturanın totalAmount'ını aşmasın (nakit fazlası para üstü olur).
      const paymentParts: { method: PaymentMethod; amount: number; accountId?: string }[] = []
      if (!isCredit && invoiceTotal > 0) {
        if (splitMode) {
          let remaining = invoiceTotal
          // Kart/Havale önce, nakit en sona → nakit fazlası para üstü olarak yutulur.
          for (const m of ["CREDIT_CARD", "BANK_TRANSFER", "CASH"] as PaymentMethod[]) {
            const want = round2(parseAmount(split[m]))
            if (want <= 0) continue
            const pay = Math.min(want, round2(remaining))
            if (pay <= 0) continue
            const acc =
              (m === "CASH"
                ? cashAccountId
                : m === "CREDIT_CARD"
                  ? (cardAccountId ?? bankAccountId)
                  : bankAccountId) ?? accountId
            paymentParts.push({ method: m, amount: pay, accountId: acc || undefined })
            remaining = round2(remaining - pay)
          }
        } else {
          paymentParts.push({ method: paymentMethod, amount: invoiceTotal, accountId: accountId || undefined })
        }

        for (const part of paymentParts) {
          const payRes = await fetch("/api/faturalar/odemeler", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              invoiceId: invoice.id,
              companyId,
              amount: part.amount,
              paymentMethod: part.method,
              accountId: part.accountId,
              paymentDate: new Date().toISOString(),
            }),
          })
          if (!payRes.ok) {
            const payErr = await payRes.json().catch(() => ({}))
            toast({
              title: "Fiş oluştu, ödeme kaydedilemedi",
              description: payErr?.error || "Ödemeyi Fişler üzerinden tekrar deneyin",
              variant: "destructive",
            })
            setIsSubmitting(false)
            return
          }
        }
      }

      const paidSum = round2(paymentParts.reduce((s, p) => s + p.amount, 0))
      toast({
        title: "Alış kaydedildi",
        description: `${invoice.invoiceNo ?? "Fiş"} oluşturuldu${
          isCredit ? " (açık hesap)" : ` • ${currency(paidSum)} ödendi`
        }`,
      })

      // Fiş için alışın anlık görüntüsü — sepet birazdan sıfırlanacağı için burada al.
      // Toplamlar faturanın sunucudaki değerleriyle hizalı olsun (fiş = fatura).
      const netVal = invoice?.netAmount != null ? Number(invoice.netAmount) : t.net
      const vatVal = invoice?.vatAmount != null ? Number(invoice.vatAmount) : t.vat
      // Ödeme dökümü/para üstü: parçalı modda parçalardan, değilse nakit ödenenden.
      let tenderVal: number
      let changeVal: number
      let receiptParts: { label: string; amount: number }[] | undefined
      if (splitMode && !isCredit) {
        const methodLabel = (m: PaymentMethod) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m
        receiptParts = paymentParts.map((p) => ({ label: methodLabel(p.method), amount: p.amount }))
        const enteredCash = parseAmount(split.CASH)
        const recordedCash = paymentParts.find((p) => p.method === "CASH")?.amount ?? 0
        tenderVal = splitPaid
        changeVal = Math.max(0, round2(enteredCash - recordedCash))
      } else {
        tenderVal = parseFloat(tk.tendered.replace(",", ".")) || 0
        changeVal = tenderVal > 0 ? Math.max(0, round2(tenderVal - invoiceTotal)) : 0
        receiptParts = undefined
      }
      const receipt: ReceiptData = {
        direction: "incoming",
        invoiceNo: invoice.invoiceNo ?? null,
        date: new Date().toISOString(),
        companyName: selectedCompany?.name ?? "",
        company: receiptCompany,
        counterpartyName: tk.supplierId ? suppliers.find((s) => s.id === tk.supplierId)?.name ?? null : null,
        notes: tk.note.trim() || null,
        items: cart.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          total: lineTotals(l).total,
        })),
        net: netVal,
        vat: vatVal,
        total: invoiceTotal,
        paymentLabel: PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ?? "Nakit",
        tendered: tenderVal,
        change: changeVal,
        isCredit,
        parts: receiptParts,
      }
      setLastPurchase({ id: invoice.id, invoiceNo: invoice.invoiceNo, receipt })
      resetPurchase()
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "Alış tamamlanamadı", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }, [
    companyId,
    tickets,
    activeTicket,
    warehouseId,
    isCredit,
    paymentMethod,
    accountId,
    toast,
    resetPurchase,
    suppliers,
    selectedCompany,
    splitMode,
    split,
    splitPaid,
    cashAccountId,
    bankAccountId,
    cardAccountId,
  ])

  // F2 → alışı tamamla (POS benzeri hızlı kapatma).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault()
        if (!isSubmitting && active.cart.length > 0) handleComplete()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleComplete, isSubmitting, active.cart.length])

  const previewUrl = (id: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/faturalar/${id}/onizleme?company=${companyId}`

  const printInvoice = () => {
    if (!lastPurchase) return
    window.open(previewUrl(lastPurchase.id), "_blank", "noopener")
  }

  // autoPrint=false → ön gösterim sayfası (kullanıcı isterse oradan yazdırır)
  // autoPrint=true  → pencereyi açar açmaz yazdırma diyaloğunu getirir
  const openReceipt = (autoPrint: boolean) => {
    if (!lastPurchase) return
    const w = window.open("", "_blank", "width=420,height=720")
    if (!w) {
      toast({
        title: "Açılır pencere engellendi",
        description: "Fiş için bu site için açılır pencerelere izin verin.",
        variant: "destructive",
      })
      return
    }
    w.document.write(buildReceiptHtml(lastPurchase.receipt, autoPrint, receiptTemplate))
    w.document.close()
    w.focus()
  }

  const sharePurchase = async () => {
    if (!lastPurchase) return
    const url = previewUrl(lastPurchase.id)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Alış faturası", url })
        return
      } catch {
        /* iptal → kopyalamaya düş. */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: "Bağlantı kopyalandı", description: "Fatura önizleme bağlantısı panoya kopyalandı." })
    } catch {
      window.open(url, "_blank", "noopener")
    }
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const tabCls = (activeState: boolean) =>
    cn(
      "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
      activeState
        ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/70"
    )

  return (
    <div className="space-y-3">
      {/* Tutar / Ödenen / Para Üstü kutuları */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Tutar" value={currency(totals.total)} tone="brand" />
        <StatTile label="Ödenen" value={currency(paidDisplay)} tone="blue" />
        <StatTile label="Para Üstü" value={currency(changeDisplay)} tone="green" />
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[1fr_380px]">
        {/* === SOL: park sekmeleri + sepet === */}
        <div className="space-y-3">
          {/* Park edilen tedarikçiler */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tickets.map((t, i) => {
              const tt = cartTotals(t.cart).total
              const supp = t.supplierId ? suppliers.find((s) => s.id === t.supplierId)?.name : null
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveTicket(i)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                    i === activeTicket
                      ? "border-kobipo-blue bg-kobipo-blue/10 dark:border-primary dark:bg-primary/15"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <span className="font-semibold">{supp || `Tedarikçi ${i + 1}`}</span>
                  <span className="tabular-nums text-muted-foreground">{currency(tt)}</span>
                  {t.cart.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-kobipo-green" />}
                </button>
              )
            })}
          </div>

          <Card>
            <CardContent className="space-y-3 p-3">
              {/* Muhtelif tutar + sepeti temizle */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PackagePlus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Alış Sepeti</span>
                  <span className="text-xs text-muted-foreground">({active.cart.length} kalem)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Input
                      value={miscAmount}
                      onChange={(e) => setMiscAmount(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addMisc()}
                      inputMode="decimal"
                      placeholder="Muhtelif tutar"
                      className="h-9 w-32 text-right"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addMisc}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {active.cart.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => patchCart(() => [])}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Temizle
                    </Button>
                  )}
                </div>
              </div>

              {active.cart.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <PackagePlus className="mx-auto mb-2 h-7 w-7 opacity-40" />
                  Sepet boş — yukarıdan barkod okutun, ürün arayın ya da hızlı ürün tuşlarını kullanın
                </div>
              ) : (
                <div className="overflow-auto xl:max-h-[46vh]">
                  <Table>
                    <TableHeader>
                      <TableRow className="sticky top-0 z-10 bg-card">
                        <TableHead className="w-10" />
                        <TableHead>Ürün</TableHead>
                        <TableHead className="w-36 text-center">Miktar</TableHead>
                        <TableHead className="w-28 text-right">Alış Fiyatı</TableHead>
                        <TableHead className="w-16 text-right">KDV%</TableHead>
                        <TableHead className="w-28 text-right">Tutar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {active.cart.map((line) => {
                        const t = lineTotals(line)
                        return (
                          <TableRow key={line.key}>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => removeLine(line.key)}
                                title="Satırı sil"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Input
                                  value={line.description}
                                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                                  className="min-w-[140px] flex-1"
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 shrink-0 gap-1 px-2 text-xs"
                                  title={line.productId ? "Geçmiş alış/satış fiyatları" : "Fiyat geçmişi için kayıtlı ürün gerekir"}
                                  disabled={!line.productId}
                                  onClick={() => openPriceHistory(line)}
                                >
                                  <Clock className="h-3.5 w-3.5" />
                                  Geçmiş
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-center">
                                <QuantityStepper
                                  value={line.quantity}
                                  onChange={(v) => updateLine(line.key, { quantity: v })}
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={
                                  priceEdit?.key === line.key ? priceEdit.value : numInput(round2(line.unitPrice))
                                }
                                placeholder="0"
                                onChange={(e) => {
                                  setPriceEdit({ key: line.key, value: e.target.value })
                                  updateLine(line.key, { unitPrice: parseFloat(e.target.value) || 0 })
                                }}
                                onBlur={() => setPriceEdit(null)}
                                className="w-24 text-right"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="1"
                                min="0"
                                value={numInput(line.vatRate)}
                                placeholder="0"
                                onChange={(e) => updateLine(line.key, { vatRate: parseFloat(e.target.value) || 0 })}
                                className="w-14 text-right"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={
                                  totalEdit?.key === line.key ? totalEdit.value : numInput(round2(t.total))
                                }
                                placeholder="0"
                                onChange={(e) => {
                                  setTotalEdit({ key: line.key, value: e.target.value })
                                  updateLineTotal(line.key, parseFloat(e.target.value) || 0)
                                }}
                                onBlur={() => setTotalEdit(null)}
                                className="w-24 text-right font-semibold tabular-nums"
                                title="Tutarı değiştir — birim fiyat otomatik hesaplanır"
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ürün arama — sepetin altında, hızlı ürünlerin üstünde */}
          <Card className="overflow-hidden">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-kobipo-blue dark:text-primary" />
                <span className="text-sm font-semibold">Ürün Ara / Ekle</span>
                <span className="text-xs text-muted-foreground">— barkod okut, ürün ara ya da yeni ekle</span>
              </div>
              <ProductCombobox
                companyId={companyId}
                products={products}
                defaults={{ unit: "ADET", vatRate: 20 }}
                priceContext="purchase"
                onSelect={addProductToCart}
                createButtonLabel="Yeni Ürün"
                categoryOptions={categoryOptions}
                warehouses={warehouses}
              />
            </CardContent>
          </Card>

          {/* Hızlı ürün tuşları */}
          {products.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Hızlı Ürünler</span>
                </div>
                {productCategories.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    <button type="button" onClick={() => setActiveCat(ALL_CATEGORIES)} className={tabCls(activeCat === ALL_CATEGORIES)}>
                      Tümü
                    </button>
                    {productCategories.map((c) => (
                      <button key={c} type="button" onClick={() => setActiveCat(c)} className={tabCls(activeCat === c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid max-h-[22vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
                  {quickProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProductToCart(p)}
                      className="flex flex-col justify-between gap-1 rounded-lg border border-border p-2 text-left transition-colors hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                    >
                      <span className="line-clamp-2 text-xs font-medium">{p.name}</span>
                      <span className="text-[11px] font-semibold text-kobipo-blue dark:text-primary">
                        {p.salePrice != null ? currency(Number(p.salePrice)) : "—"}
                      </span>
                    </button>
                  ))}
                  {quickProducts.length === 0 && (
                    <p className="col-span-full py-3 text-center text-xs text-muted-foreground">
                      Bu kategoride ürün yok
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* === SAĞ: tedarikçi + ödeme paneli === */}
        <div className="space-y-3 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <Card>
            <CardContent className="space-y-3 p-3">
              <div>
                <Label className="text-xs text-muted-foreground">Tedarikçi (opsiyonel)</Label>
                <div className="mt-1.5">
                  <CounterpartyCombobox
                    customers={[]}
                    suppliers={suppliers}
                    selectedSupplierId={active.supplierId}
                    onSelect={(sel) => patchTicket({ supplierId: sel && sel.kind === "supplier" ? sel.id : undefined })}
                    placeholder="Tedarikçi ara (serbest alış için boş bırakın)…"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="fisNotu" className="text-xs text-muted-foreground">
                  Fiş notu (opsiyonel)
                </Label>
                <Input
                  id="fisNotu"
                  className="mt-1.5"
                  value={active.note}
                  maxLength={200}
                  placeholder="Fişe yazılacak kısa not…"
                  onChange={(e) => patchTicket({ note: e.target.value })}
                />
              </div>

              {warehouses.length > 1 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Depo</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Depo seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name} {w.isDefault ? "(Ana)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ödeme: tek yöntem veya parçalı */}
          <Card>
            <CardContent className="space-y-3 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ödeme</Label>
              {!isCredit && (
                <button
                  type="button"
                  onClick={() => setSplitMode((v) => !v)}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-lg border-2 p-2.5 text-sm font-bold transition-colors",
                    splitMode
                      ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                      : "border-dashed border-kobipo-blue/50 text-kobipo-blue hover:bg-kobipo-blue/5 dark:border-primary/50 dark:text-primary dark:hover:bg-primary/10"
                  )}
                >
                  <Split className="h-4 w-4" />
                  Parçalı Ödeme{splitMode ? " • Açık" : ""}
                </button>
              )}

              {isCredit ? null : splitMode ? (
                <div className="space-y-2">
                  {PAYMENT_METHODS.map((m) => {
                    const Icon = m.icon
                    return (
                      <div key={m.value} className="flex items-center gap-2">
                        <span className="flex w-28 shrink-0 items-center gap-1.5 text-sm font-medium">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {m.label}
                        </span>
                        <Input
                          value={split[m.value]}
                          onChange={(e) => setSplit((s) => ({ ...s, [m.value]: e.target.value }))}
                          inputMode="decimal"
                          placeholder="0,00"
                          className="h-9 flex-1 text-right tabular-nums"
                        />
                      </div>
                    )
                  })}
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
                    <span className="text-muted-foreground">Toplam ödenen</span>
                    <span className="font-semibold tabular-nums">{currency(splitPaid)}</span>
                  </div>
                  <div className="flex items-center justify-between px-1 text-sm">
                    <span className="text-muted-foreground">{splitRemaining >= 0 ? "Kalan" : "Para üstü"}</span>
                    <span
                      className={cn(
                        "font-bold tabular-nums",
                        splitRemaining > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-kobipo-green"
                      )}
                    >
                      {currency(Math.abs(splitRemaining))}
                    </span>
                  </div>
                  {splitRemaining > 0.005 && (
                    <button
                      type="button"
                      onClick={fillSplitRemainder}
                      className="w-full rounded-lg border border-kobipo-green/40 bg-kobipo-green/10 py-2 text-sm font-semibold text-kobipo-green transition-colors hover:bg-kobipo-green/20"
                    >
                      Kalanı nakite ekle
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {paymentMethod === "CASH" && (
                    <>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Ödenen (nakit)</Label>
                        <span className="text-xs text-muted-foreground">
                          Para Üstü: <span className="font-bold text-kobipo-green">{currency(change)}</span>
                        </span>
                      </div>
                      <Input
                        value={active.tendered}
                        onChange={(e) => setTendered(e.target.value)}
                        inputMode="decimal"
                        placeholder="0,00"
                        className="h-11 text-right text-lg font-bold tabular-nums"
                      />
                      <div className="grid grid-cols-4 gap-2">
                        {[20, 50, 100, 200].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setTendered(String(n))}
                            className="rounded-lg border border-border py-2 text-sm font-semibold transition-colors hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => addCash(20)}
                          className="rounded-lg border border-border py-2 text-sm font-semibold transition-colors hover:bg-muted"
                        >
                          +20
                        </button>
                        <button
                          type="button"
                          onClick={() => addCash(-20)}
                          className="rounded-lg border border-border py-2 text-sm font-semibold transition-colors hover:bg-muted"
                        >
                          −20
                        </button>
                        <button
                          type="button"
                          onClick={() => setTendered(String(round2(totals.total)))}
                          className="rounded-lg border border-kobipo-green/40 bg-kobipo-green/10 py-2 text-sm font-semibold text-kobipo-green transition-colors hover:bg-kobipo-green/20"
                        >
                          Tam
                        </button>
                      </div>
                    </>
                  )}

                  <div className={cn("grid grid-cols-3 gap-2", paymentMethod === "CASH" && "border-t pt-3")}>
                    {PAYMENT_METHODS.map((m) => {
                      const Icon = m.icon
                      const activeState = !isCredit && paymentMethod === m.value
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => {
                            setPaymentMethod(m.value)
                            setIsCredit(false)
                            if (m.value !== "CASH") setTendered("")
                          }}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-[11px] font-semibold transition-colors",
                            activeState
                              ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                              : "border-border hover:bg-muted"
                          )}
                        >
                          <Icon className="h-5 w-5" />
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => setIsCredit((v) => !v)}
                className={cn(
                  "w-full rounded-lg border p-2.5 text-sm font-semibold transition-colors",
                  isCredit
                    ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                Açık Hesap (sonra öde) {isCredit ? "• Açık" : ""}
              </button>

              {!isCredit && !splitMode && accounts.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Kasa / Banka Hesabı</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Hesap seçin" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} {a.type === "CASH" ? "(Kasa)" : "(Banka)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!isCredit && splitMode && (
                <p className="px-1 text-xs text-muted-foreground">
                  Nakit kasadan, kart/havale bankadan otomatik işlenir. Kalan tutar açık hesap olarak kalır.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Özet + Tamamla */}
          <Card className="border-kobipo-blue/30">
            <CardContent className="space-y-2 p-3">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Ara Toplam</span>
                <span className="tabular-nums">{currency(totals.net)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>KDV</span>
                <span className="tabular-nums">{currency(totals.vat)}</span>
              </div>
              <div className="flex items-baseline justify-between rounded-lg bg-kobipo-pale/60 px-3 py-2 dark:bg-primary/10">
                <span className="font-semibold">Genel Toplam</span>
                <span className="text-2xl font-extrabold tabular-nums text-kobipo-blue dark:text-primary">
                  {currency(totals.total)}
                </span>
              </div>
              <Button
                className="mt-1 h-12 w-full text-base"
                variant="success"
                onClick={handleComplete}
                disabled={isSubmitting || active.cart.length === 0}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    İşleniyor…
                  </>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    Alışı Tamamla
                    {totals.total > 0 && (
                      <span className="ml-1 rounded-md bg-white/20 px-2 py-0.5 text-sm font-bold tabular-nums">
                        {currency(totals.total)}
                      </span>
                    )}
                  </span>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                İpucu: <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">F2</kbd> ile alışı tamamla
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Önceki fiyatlar (geçmiş) modalı */}
      <Dialog open={priceModalLine !== null} onOpenChange={(open) => !open && setPriceModalLine(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-kobipo-blue dark:text-primary" />
              Önceki Fiyatlar
            </DialogTitle>
            <DialogDescription>
              {priceModalLine?.description
                ? `"${priceModalLine.description}" ürününün geçmiş işlem fiyatları.`
                : "Bu ürünün geçmiş işlem fiyatları."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1 border-b pb-2">
            {PRICE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActivePriceTab(tab.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  activePriceTab === tab.key
                    ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {priceHistoryLoading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Yükleniyor…
              </div>
            ) : priceHistory[activePriceTab].length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Bu sekmede kayıt bulunamadı.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/70 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Tarih</th>
                    <th className="p-2 font-medium">Cari</th>
                    <th className="p-2 text-right font-medium">Fiyat</th>
                    <th className="p-2 text-center font-medium">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {priceHistory[activePriceTab].map((row, i) => (
                    <tr key={i} className="hover:bg-muted/40">
                      <td className="whitespace-nowrap p-2">{new Date(row.date).toLocaleDateString("tr-TR")}</td>
                      <td className="max-w-[220px] truncate p-2" title={row.cariName}>
                        {row.cariName}
                      </td>
                      <td className="p-2 text-right font-semibold tabular-nums text-kobipo-blue dark:text-primary">
                        {currency(row.price)}
                      </td>
                      <td className="p-2 text-center">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyHistoryPrice(row.price)}>
                          <Check className="mr-1 h-3 w-3" /> Seç
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter>
            <Button variant="secondary" className="w-full" onClick={() => setPriceModalLine(null)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alış tamamlandı: yazdır / paylaş */}
      <Dialog open={lastPurchase !== null} onOpenChange={(open) => !open && setLastPurchase(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-kobipo-green" />
              Alış tamamlandı
            </DialogTitle>
            <DialogDescription>
              {lastPurchase?.invoiceNo ? `${lastPurchase.invoiceNo} oluşturuldu.` : "Fatura oluşturuldu."} Fiş ya da fatura
              yazdırabilir veya paylaşabilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => openReceipt(false)}>
              <Receipt className="mr-2 h-4 w-4" />
              Fiş
            </Button>
            <Button variant="outline" onClick={() => openReceipt(true)}>
              <Printer className="mr-2 h-4 w-4" />
              Yazdır
            </Button>
            <Button variant="outline" onClick={printInvoice}>
              <FileText className="mr-2 h-4 w-4" />
              Fatura
            </Button>
            <Button variant="outline" onClick={sharePurchase}>
              <Share2 className="mr-2 h-4 w-4" />
              Paylaş
            </Button>
          </div>
          <DialogFooter>
            <Button className="w-full" onClick={() => setLastPurchase(null)}>
              Yeni Alış
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: "brand" | "blue" | "green" }) {
  const toneClass =
    tone === "green"
      ? "text-kobipo-green"
      : tone === "blue"
        ? "text-kobipo-blue dark:text-primary"
        : "text-kobipo-navy dark:text-foreground"
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-extrabold tabular-nums lg:text-xl", toneClass)}>{value}</p>
    </div>
  )
}
