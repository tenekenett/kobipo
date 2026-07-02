"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { CounterpartyCombobox, type Counterparty } from "@/components/e-donusum/counterparty-combobox"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { cn } from "@/lib/utils"
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Landmark,
  Loader2,
  Package,
  Plus,
  Printer,
  Share2,
  ShoppingCart,
  Trash2,
  Zap,
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

type FinancialAccount = { id: string; name: string; type: string }

type PaymentMethod = "CASH" | "CREDIT_CARD" | "BANK_TRANSFER"

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "CASH", label: "Nakit", icon: Banknote },
  { value: "CREDIT_CARD", label: "Kredi Kartı", icon: CreditCard },
  { value: "BANK_TRANSFER", label: "Havale/EFT", icon: Landmark },
]

// Aynı anda açık tutulabilen park edilmiş satış (müşteri) sayısı.
const NUM_TICKETS = 5
const ALL_CATEGORIES = "__ALL__"

type Ticket = { cart: CartLine[]; customerId?: string; tendered: string }
const emptyTicket = (): Ticket => ({ cart: [], customerId: undefined, tendered: "" })

const currency = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n || 0)

/** type="number" input'larda 0 değerini boş göster — baştaki "0" takılmasın. */
const numInput = (n: number) => (n === 0 ? "" : String(n))

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

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

export function QuickSaleScreen() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  const companyId = selectedCompanyId
  const isEDonusumEnabled = Boolean(selectedCompany?.isEDonusumEnabled)
  const { toast } = useToast()

  const [products, setProducts] = useState<QuickProduct[]>([])
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [customers, setCustomers] = useState<Counterparty[]>([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; isDefault?: boolean }[]>([])
  const [warehouseId, setWarehouseId] = useState<string>("")
  const [warehouseStocks, setWarehouseStocks] = useState<
    { warehouseId: string; productId: string; quantity: number }[]
  >([])

  // Park edilen satışlar (Müşteri 1..N). Her biri kendi sepeti + müşterisi + ödenen tutarı.
  const [tickets, setTickets] = useState<Ticket[]>(() =>
    Array.from({ length: NUM_TICKETS }, emptyTicket)
  )
  const [activeTicket, setActiveTicket] = useState(0)
  const active = tickets[activeTicket]

  const [isCredit, setIsCredit] = useState(false) // Veresiye / Açık Hesap
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH")
  const [accountId, setAccountId] = useState<string>("")
  const [eArsiv, setEArsiv] = useState(false)
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)
  const [miscAmount, setMiscAmount] = useState("")

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastSale, setLastSale] = useState<
    { id: string; invoiceNo?: string | null; isEArsiv: boolean } | null
  >(null)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    const load = async () => {
      try {
        const [prodRes, custRes, accRes, whRes, catRes, stockRes] = await Promise.all([
          fetch(`/api/stok/products?companyId=${companyId}&isService=false`),
          fetch(`/api/cari/customers?companyId=${companyId}`),
          fetch(`/api/finans/accounts?companyId=${companyId}`),
          fetch(`/api/depolar?companyId=${companyId}`),
          fetch(`/api/company/definitions?companyId=${companyId}&type=PRODUCT_CATEGORY`),
          fetch(`/api/depolar/stok?companyId=${companyId}`),
        ])

        if (!cancelled && catRes.ok) {
          const data = await catRes.json()
          setCategoryOptions(
            (Array.isArray(data) ? data : []).map((d: any) => String(d.label)).filter(Boolean)
          )
        }
        if (!cancelled && stockRes.ok) {
          const data = await stockRes.json()
          setWarehouseStocks(
            (Array.isArray(data?.stocks) ? data.stocks : []).map((s: any) => ({
              warehouseId: s.warehouseId,
              productId: s.productId,
              quantity: Number(s.quantity) || 0,
            }))
          )
        }
        if (!cancelled && whRes.ok) {
          const data = await whRes.json()
          const list = Array.isArray(data) ? data : []
          setWarehouses(list)
          const def = list.find((w: any) => w.isDefault) ?? list[0]
          if (def) setWarehouseId((prev) => prev || def.id)
        }
        if (!cancelled && prodRes.ok) {
          const data = await prodRes.json()
          setProducts(
            (Array.isArray(data) ? data : []).map((p: any) => ({
              id: p.id,
              name: p.name,
              code: p.code,
              salePrice: p.salePrice != null ? Number(p.salePrice) : null,
              vatRate: Number(p.vatRate) || 20,
              unit: p.unit,
              category: p.category ?? null,
            }))
          )
        }
        if (!cancelled && custRes.ok) {
          const data = await custRes.json()
          const items = Array.isArray(data) ? data : data?.items ?? []
          setCustomers(items.map((c: any) => ({ id: c.id, name: c.name, taxNumber: c.taxNumber })))
        }
        if (!cancelled && accRes.ok) {
          const data = await accRes.json()
          const list: FinancialAccount[] = (Array.isArray(data) ? data : []).map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.type,
          }))
          setAccounts(list)
          const firstCash = list.find((a) => a.type === "CASH") ?? list[0]
          if (firstCash) setAccountId((prev) => prev || firstCash.id)
        }
      } catch (error) {
        console.error("Hızlı satış verileri yüklenemedi:", error)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [companyId])

  const bestWarehouseByProduct = useMemo(() => {
    const m = new Map<string, { warehouseId: string; qty: number }>()
    for (const s of warehouseStocks) {
      const cur = m.get(s.productId)
      if (!cur || s.quantity > cur.qty) m.set(s.productId, { warehouseId: s.warehouseId, qty: s.quantity })
    }
    return m
  }, [warehouseStocks])

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
      if (product.id) {
        const best = bestWarehouseByProduct.get(product.id)
        if (best) setWarehouseId(best.warehouseId)
      }
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
    [bestWarehouseByProduct, patchCart]
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
  const removeLine = useCallback(
    (key: string) => patchCart((cart) => cart.filter((l) => l.key !== key)),
    [patchCart]
  )

  const totals = useMemo(() => cartTotals(active.cart), [active.cart])
  const tenderedNum = useMemo(() => parseFloat(active.tendered.replace(",", ".")) || 0, [active.tendered])
  const change = tenderedNum > 0 ? Math.max(0, round2(tenderedNum - totals.total)) : 0

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

  const resetSale = useCallback(() => {
    setTickets((prev) => prev.map((t, i) => (i === activeTicket ? emptyTicket() : t)))
    setIsCredit(false)
    setEArsiv(false)
    setPaymentMethod("CASH")
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
      const useEArsiv = eArsiv && isEDonusumEnabled
      const invoiceRes = await fetch("/api/e-donusum/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: "SALES",
          invoiceType: useEArsiv ? "E_ARCHIVE" : "MANUAL",
          customerId: tk.customerId || null,
          warehouseId: warehouseId || undefined,
          date: new Date().toISOString(),
          currency: "TRY",
          sendInvoice: useEArsiv,
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
      if (!invoiceRes.ok) throw new Error(invoice?.error || "Satış faturası oluşturulamadı")

      if (!isCredit && t.total > 0) {
        const payRes = await fetch("/api/faturalar/odemeler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: invoice.id,
            companyId,
            amount: t.total,
            paymentMethod,
            accountId: accountId || undefined,
            paymentDate: new Date().toISOString(),
          }),
        })
        if (!payRes.ok) {
          const payErr = await payRes.json().catch(() => ({}))
          toast({
            title: "Fatura oluştu, tahsilat kaydedilemedi",
            description: payErr?.error || "Ödemeyi Satış Faturaları üzerinden tekrar deneyin",
            variant: "destructive",
          })
          setIsSubmitting(false)
          return
        }
      }

      toast({
        title: "Satış tamamlandı",
        description: `${invoice.invoiceNo ?? "Fatura"} oluşturuldu${
          isCredit ? " (veresiye)" : ` • ${currency(t.total)} tahsil edildi`
        }`,
      })
      setLastSale({ id: invoice.id, invoiceNo: invoice.invoiceNo, isEArsiv: useEArsiv })
      resetSale()
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "Satış tamamlanamadı", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }, [
    companyId,
    tickets,
    activeTicket,
    eArsiv,
    isEDonusumEnabled,
    warehouseId,
    isCredit,
    paymentMethod,
    accountId,
    toast,
    resetSale,
  ])

  // F2 → satışı tamamla (POS benzeri hızlı kapatma).
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

  const printSale = () => {
    if (!lastSale) return
    window.open(previewUrl(lastSale.id), "_blank", "noopener")
  }

  const shareSale = async () => {
    if (!lastSale) return
    const url = previewUrl(lastSale.id)
    if (lastSale.isEArsiv) {
      try {
        const res = await fetch(`/api/e-donusum/invoices/${lastSale.id}/pdf`)
        if (res.ok) {
          const blob = await res.blob()
          const file = new File([blob], `${lastSale.invoiceNo || "fatura"}.pdf`, { type: "application/pdf" })
          const navAny = navigator as any
          if (navAny.canShare && navAny.canShare({ files: [file] })) {
            await navAny.share({ files: [file], title: "Fatura" })
            return
          }
          const dl = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = dl
          a.download = file.name
          a.click()
          URL.revokeObjectURL(dl)
          return
        }
      } catch {
        /* PDF alınamadı → link paylaşımına düş. */
      }
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Satış faturası", url })
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
      {/* === ÜST BAR: barkod/arama + tutar kutuları === */}
      <div className="grid gap-3 xl:grid-cols-[1fr_auto]">
        <Card className="overflow-hidden">
          <CardContent className="flex items-center gap-3 p-3">
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground sm:flex">
              <Zap className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <ProductCombobox
                companyId={companyId}
                products={products}
                defaults={{ unit: "ADET", vatRate: 20 }}
                priceContext="sale"
                onSelect={addProductToCart}
                createButtonLabel="Yeni Ürün"
                categoryOptions={categoryOptions}
                warehouses={warehouses}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3 xl:w-[420px]">
          <StatTile label="Tutar" value={currency(totals.total)} tone="brand" />
          <StatTile label="Ödenen" value={currency(tenderedNum)} tone="blue" />
          <StatTile label="Para Üstü" value={currency(change)} tone="green" />
        </div>
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[1fr_380px]">
        {/* === SOL: park sekmeleri + sepet === */}
        <div className="space-y-3">
          {/* Park edilen müşteriler */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tickets.map((t, i) => {
              const tt = cartTotals(t.cart).total
              const cust = t.customerId ? customers.find((c) => c.id === t.customerId)?.name : null
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
                  <span className="font-semibold">{cust || `Müşteri ${i + 1}`}</span>
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
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Sepet</span>
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
                  <ShoppingCart className="mx-auto mb-2 h-7 w-7 opacity-40" />
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
                        <TableHead className="w-28 text-right">Fiyat</TableHead>
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
                              <Input
                                value={line.description}
                                onChange={(e) => updateLine(line.key, { description: e.target.value })}
                                className="min-w-[160px]"
                              />
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
                                value={numInput(line.unitPrice)}
                                placeholder="0"
                                onChange={(e) => updateLine(line.key, { unitPrice: parseFloat(e.target.value) || 0 })}
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
                            <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                              {currency(t.total)}
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

        {/* === SAĞ: müşteri + ödeme paneli === */}
        <div className="space-y-3 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <Card>
            <CardContent className="space-y-3 p-3">
              <div>
                <Label className="text-xs text-muted-foreground">Müşteri (opsiyonel)</Label>
                <div className="mt-1.5">
                  <CounterpartyCombobox
                    customers={customers}
                    suppliers={[]}
                    selectedCustomerId={active.customerId}
                    onSelect={(sel) => patchTicket({ customerId: sel && sel.kind === "customer" ? sel.id : undefined })}
                    placeholder="Müşteri ara (perakende için boş bırakın)…"
                  />
                </div>
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

          {/* Ödeme: hızlı nakit + para üstü + yöntem */}
          <Card>
            <CardContent className="space-y-3 p-3">
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

              <div className="grid grid-cols-3 gap-2 border-t pt-3">
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
                Veresiye / Açık Hesap {isCredit ? "• Açık" : ""}
              </button>

              {!isCredit && accounts.length > 0 && (
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

              {isEDonusumEnabled && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={eArsiv} onChange={(e) => setEArsiv(e.target.checked)} className="rounded" />
                  E-Arşiv olarak kes (GİB'e gönder)
                </label>
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
                    Satışı Tamamla
                    {totals.total > 0 && (
                      <span className="ml-1 rounded-md bg-white/20 px-2 py-0.5 text-sm font-bold tabular-nums">
                        {currency(totals.total)}
                      </span>
                    )}
                  </span>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                İpucu: <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">F2</kbd> ile satışı tamamla
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Satış tamamlandı: yazdır / paylaş */}
      <Dialog open={lastSale !== null} onOpenChange={(open) => !open && setLastSale(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-kobipo-green" />
              Satış tamamlandı
            </DialogTitle>
            <DialogDescription>
              {lastSale?.invoiceNo ? `${lastSale.invoiceNo} oluşturuldu.` : "Fatura oluşturuldu."} Yazdırabilir veya
              paylaşabilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={printSale}>
              <Printer className="mr-2 h-4 w-4" />
              Yazdır
            </Button>
            <Button variant="outline" onClick={shareSale}>
              <Share2 className="mr-2 h-4 w-4" />
              Paylaş
            </Button>
          </div>
          <DialogFooter>
            <Button className="w-full" onClick={() => setLastSale(null)}>
              Yeni Satış
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
