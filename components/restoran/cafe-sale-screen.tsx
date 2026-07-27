"use client"

// Kahveci satış ekranı — bkz. docs/restoran/PLAN.md "Adım 5", ILERLEME.md "Adım 7".
//
// Hızlı Satış'tan (components/satis/quick-sale-screen.tsx) farkı: burada kasiyer
// fiyat/KDV/miktar düzenlemez, menüye basar. O yüzden sepet satırı düz metin +
// adet adımlayıcıdan ibaret; ödeme kutusu ve fiş yazdırma ise paylaşılan
// parçalardan geliyor (lib/satis/payment.ts + components/satis/payment-panel.tsx).
//
// Yetersiz stok uyarısı sunucunun stok düşümüyle AYNI saf fonksiyonu kullanır
// (expandRecipeLines): uyarı ile fiilen düşen miktar hiçbir zaman çelişmez.
// Uyarı ENGELLEMEZ — PLAN.md "Adım 4": kahvecide stok girişleri gecikir,
// engelleyici kontrol kasayı kilitler.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChefHat,
  CheckCircle2,
  CupSoda,
  Loader2,
  PackageMinus,
  Printer,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { CounterpartyCombobox } from "@/components/e-donusum/counterparty-combobox"
import { PaymentPanel } from "@/components/satis/payment-panel"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import {
  useAccounts,
  useCustomers,
  useProducts,
  useRecipes,
  useReceiptTemplate,
  useWarehouses,
  type RefProduct,
} from "@/lib/swr/use-company-data"
import { buildReceiptHtml, currency, type ReceiptData } from "@/lib/fis/receipt-html"
import { qty } from "@/lib/format"
import {
  buildPaymentParts,
  emptyPaymentState,
  paymentSummary,
  receiptParts,
  round2,
  PAYMENT_METHOD_LABELS,
  type PaymentState,
} from "@/lib/satis/payment"
import { expandRecipeLines } from "@/lib/stock/recipe-expand"
import { cn } from "@/lib/utils"

type CafeLine = {
  key: string
  productId: string
  name: string
  unit: string
  /** KDV hariç birim fiyat — fatura API'si net bekliyor. */
  unitPrice: number
  vatRate: number
  quantity: number
}

const ALL_CATEGORIES = "__ALL__"

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`

/** Menüde gösterilen KDV dahil fiyat — kahvecide fiyat listesi brüttür. */
const grossPrice = (p: { salePrice: number | null; vatRate: number }) =>
  (p.salePrice ?? 0) * (1 + (Number(p.vatRate) || 0) / 100)

const lineNet = (l: CafeLine) => l.quantity * l.unitPrice
const lineTotal = (l: CafeLine) => lineNet(l) * (1 + l.vatRate / 100)

function cartTotals(cart: CafeLine[]) {
  return cart.reduce(
    (acc, l) => {
      const net = lineNet(l)
      const vat = net * (l.vatRate / 100)
      acc.net += net
      acc.vat += vat
      acc.total += net + vat
      return acc
    },
    { net: 0, vat: 0, total: 0 }
  )
}

type Shortage = {
  productId: string
  name: string
  unit: string
  need: number
  stock: number
  after: number
  /** Bu ihtiyaca yol açan menü ürünleri; doğrudan satışta boş. */
  sources: string[]
}

export function CafeSaleScreen() {
  const { selectedCompanyId: companyId, selectedCompany } = useDashboardCompany()
  const { toast } = useToast()

  const { products, isLoading: productsLoading, error: productsError } = useProducts(companyId, {
    isService: false,
  })
  const { recipes, recipeMap } = useRecipes(companyId)
  const { accounts } = useAccounts(companyId)
  const { warehouses } = useWarehouses(companyId)
  const { customers } = useCustomers(companyId)
  const { template: receiptTemplate, company: receiptCompany } = useReceiptTemplate(companyId)

  const [cart, setCart] = useState<CafeLine[]>([])
  const [search, setSearch] = useState("")
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)
  const [note, setNote] = useState("")
  const [customerId, setCustomerId] = useState<string | undefined>()
  const [warehouseId, setWarehouseId] = useState("")
  const [payment, setPayment] = useState<PaymentState>(() => emptyPaymentState())
  const [isSubmitting, setIsSubmitting] = useState(false)
  /**
   * Çift satış kilidi. `isSubmitting` state'i tek başına yetmiyor: F2 basılı
   * tutulduğunda (klavye tekrarı) ya da butona çift tıklandığında iki çağrı da
   * aynı render'da geçebilir — state güncellemesi henüz görünmemiştir. Sonuç iki
   * fiş, iki stok düşümü, iki tahsilat olurdu. Ref senkron okunup yazılır.
   */
  const submitLock = useRef(false)
  const [lastSale, setLastSale] = useState<
    { id: string; invoiceNo?: string | null; receipt: ReceiptData } | null
  >(null)

  const patchPayment = useCallback(
    (patch: Partial<PaymentState>) => setPayment((p) => ({ ...p, ...patch })),
    []
  )

  // Varsayılan depo (Ana) ve kasa hesabı — referans veriler gelince bir kez seç.
  useEffect(() => {
    if (warehouseId || warehouses.length === 0) return
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0]
    if (def) setWarehouseId(def.id)
  }, [warehouses, warehouseId])

  useEffect(() => {
    if (payment.accountId || accounts.length === 0) return
    const firstCash = accounts.find((a) => a.type === "CASH") ?? accounts[0]
    if (firstCash) patchPayment({ accountId: firstCash.id })
  }, [accounts, payment.accountId, patchPayment])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const unitOf = useCallback(
    (productId: string) => productById.get(productId)?.unit ?? null,
    [productById]
  )
  const nameOf = useCallback(
    (productId: string) => productById.get(productId)?.name ?? productId,
    [productById]
  )

  // ---- Menü ----

  const menuProducts = useMemo(
    () => products.filter((p) => p.isActive && p.isSellable && !p.isService),
    [products]
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of menuProducts) if (p.category) set.add(p.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr-TR"))
  }, [menuProducts])

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    return menuProducts
      .filter((p) => activeCat === ALL_CATEGORIES || p.category === activeCat)
      .filter(
        (p) =>
          !q ||
          p.name.toLocaleLowerCase("tr-TR").includes(q) ||
          (p.code ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
          (p.barcode ?? "").toLocaleLowerCase("tr-TR").includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"))
  }, [menuProducts, activeCat, search])

  // ---- Sepet ----

  const addProduct = useCallback((product: RefProduct) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productId === product.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: round2(next[idx].quantity + 1) }
        return next
      }
      return [
        ...prev,
        {
          key: uid(),
          productId: product.id,
          name: product.name,
          unit: product.unit || "ADET",
          unitPrice: product.salePrice != null ? Number(product.salePrice) : 0,
          vatRate: Number(product.vatRate) || 0,
          quantity: 1,
        },
      ]
    })
  }, [])

  const setLineQty = useCallback((key: string, quantity: number) => {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) => (l.key === key ? { ...l, quantity } : l))
    )
  }, [])

  const removeLine = useCallback(
    (key: string) => setCart((prev) => prev.filter((l) => l.key !== key)),
    []
  )

  const totals = useMemo(() => cartTotals(cart), [cart])
  const summary = paymentSummary(payment, totals.total)

  // ---- Yetersiz stok uyarısı ----

  const expansion = useMemo(
    () =>
      expandRecipeLines({
        lines: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        recipes: recipeMap,
        unitOf,
      }),
    [cart, recipeMap, unitOf]
  )

  const shortages = useMemo<Shortage[]>(() => {
    const rows: Shortage[] = []
    const push = (productId: string, need: number, sources: string[]) => {
      const p = productById.get(productId)
      // Ürün listede yoksa (hizmet ya da silinmiş) stok kavramı da yok.
      if (!p) return
      const stock = Number(p.stockQuantity ?? 0)
      const after = round4(stock - need)
      if (after >= 0) return
      rows.push({
        productId,
        name: p.name,
        unit: p.unit || "",
        need: round4(need),
        stock,
        after,
        sources,
      })
    }
    for (const c of expansion.components) push(c.productId, c.quantity, c.sources.map(nameOf))
    for (const d of expansion.direct) push(d.productId, d.quantity, [])
    return rows.sort((a, b) => a.after - b.after)
  }, [expansion, productById, nameOf])

  /** Genişletme hataları (birim uyuşmazlığı, döngü) — bunlar stoğu SESSİZCE eksik düşürür. */
  const expandErrors = useMemo(
    () =>
      expansion.errors.map((e) => {
        switch (e.reason) {
          case "CYCLE":
            return `Reçete döngüsü: ${(e.detail ?? e.productId).split(" → ").map(nameOf).join(" → ")}`
          case "DEPTH":
            return `"${nameOf(e.productId)}" reçetesi ${e.detail} kattan derin — açılamadı`
          case "UNIT_MISMATCH":
            return `"${nameOf(e.productId)}" için ${e.detail} dönüşümü yapılamıyor`
          default:
            return `"${nameOf(e.productId)}": ${e.reason}`
        }
      }),
    [expansion.errors, nameOf]
  )

  // ---- Kritik hammadde paneli ----

  const criticalStock = useMemo(() => {
    const componentIds = new Set<string>()
    for (const r of recipes) {
      if (!r.isActive) continue
      for (const i of r.items) componentIds.add(i.componentProductId)
    }
    return products
      .filter((p) => p.isActive && componentIds.has(p.id))
      // Yarı mamül SANALDIR (kendi reçetesi var, stok bakiyesi tutulmaz).
      .filter((p) => !recipeMap.has(p.id))
      .filter((p) => p.minStockLevel != null && p.minStockLevel > 0)
      .filter((p) => Number(p.stockQuantity ?? 0) <= Number(p.minStockLevel))
      .sort(
        (a, b) =>
          Number(a.stockQuantity ?? 0) / Number(a.minStockLevel) -
          Number(b.stockQuantity ?? 0) / Number(b.minStockLevel)
      )
  }, [products, recipes, recipeMap])

  // ---- Satışı tamamla ----

  const resetSale = useCallback(() => {
    setCart([])
    setNote("")
    setCustomerId(undefined)
    setPayment((p) => ({ ...emptyPaymentState(p.accountId) }))
  }, [])

  const handleComplete = useCallback(async () => {
    if (!companyId || cart.length === 0 || submitLock.current) return
    if (cart.some((l) => l.quantity <= 0)) {
      toast({ title: "Geçersiz miktar", description: "Tüm satırlarda adet 0'dan büyük olmalı", variant: "destructive" })
      return
    }

    const snapshot = cart
    const t = cartTotals(snapshot)
    submitLock.current = true
    setIsSubmitting(true)
    try {
      // Fiş kesilir (resmî fatura değil): daima MANUAL, GİB'e gönderim yok.
      // Reçete genişletmesi SUNUCUDA çalışıyor — buradan ek bir şey göndermeye gerek yok.
      const invoiceRes = await fetch("/api/e-donusum/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: "SALES",
          invoiceType: "MANUAL",
          isReceipt: true,
          customerId: customerId || null,
          warehouseId: warehouseId || undefined,
          date: new Date().toISOString(),
          currency: "TRY",
          notes: note.trim() || undefined,
          sendInvoice: false,
          items: snapshot.map((l) => ({
            productId: l.productId,
            description: l.name,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
          })),
        }),
      })
      const invoice = await invoiceRes.json().catch(() => ({}))
      if (!invoiceRes.ok) throw new Error(invoice?.error || "Satış fişi oluşturulamadı")

      // Tahsilat, faturanın SUNUCUDA kayıtlı toplamı üzerinden yazılır: istemcinin
      // yuvarlanmamış toplamı sunucunun 2 haneye yuvarladığı tutarı aşarsa ödeme reddedilir.
      const invoiceTotal = invoice?.totalAmount != null ? Number(invoice.totalAmount) : round2(t.total)
      const cashAccountId = accounts.find((a) => a.type === "CASH")?.id
      const bankAccountId = accounts.find((a) => a.type !== "CASH")?.id
      const parts = buildPaymentParts(payment, {
        total: invoiceTotal,
        cashAccountId,
        bankAccountId,
      })

      for (const part of parts) {
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
          // Fiş oluştu, stok düştü — geri almak yerine kullanıcıyı uyar: tahsilat
          // Fişler ekranından tamamlanabilir, fişi silmek stoğu da geri alırdı.
          toast({
            title: "Fiş oluştu, tahsilat kaydedilemedi",
            description: payErr?.error || "Ödemeyi Fişler üzerinden tekrar deneyin",
            variant: "destructive",
          })
          setIsSubmitting(false)
          return
        }
      }

      const paidSum = round2(parts.reduce((s, p) => s + p.amount, 0))
      const done = paymentSummary(payment, invoiceTotal)
      toast({
        title: "Satış tamamlandı",
        description: `${invoice.invoiceNo ?? "Fiş"} oluşturuldu${
          payment.isCredit ? " (veresiye)" : ` • ${currency(paidSum)} tahsil edildi`
        }`,
      })

      const receipt: ReceiptData = {
        direction: "outgoing",
        invoiceNo: invoice.invoiceNo ?? null,
        date: new Date().toISOString(),
        companyName: selectedCompany?.name ?? "",
        company: receiptCompany,
        counterpartyName: customerId
          ? customers.find((c) => c.id === customerId)?.name ?? null
          : null,
        notes: note.trim() || null,
        items: snapshot.map((l) => ({
          description: l.name,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          total: lineTotal(l),
        })),
        net: invoice?.netAmount != null ? Number(invoice.netAmount) : t.net,
        vat: invoice?.vatAmount != null ? Number(invoice.vatAmount) : t.vat,
        total: invoiceTotal,
        // Parçalı ödemede döküm `parts`ta; buradaki etiket tek yöntemli satışın başlığı.
        paymentLabel: payment.isCredit ? "Veresiye" : PAYMENT_METHOD_LABELS[payment.method],
        tendered: done.tendered,
        change: done.change,
        isCredit: payment.isCredit,
        parts: payment.splitMode && !payment.isCredit ? receiptParts(parts) : undefined,
      }
      setLastSale({ id: invoice.id, invoiceNo: invoice.invoiceNo, receipt })
      resetSale()
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "Satış tamamlanamadı",
        variant: "destructive",
      })
    } finally {
      // Tahsilat hatasında try içinden dönülse bile burası çalışır — kilit tek yerde açılır.
      submitLock.current = false
      setIsSubmitting(false)
    }
  }, [
    companyId,
    cart,
    customerId,
    warehouseId,
    note,
    payment,
    accounts,
    customers,
    selectedCompany,
    receiptCompany,
    resetSale,
    toast,
  ])

  // F2 → satışı tamamla (POS benzeri hızlı kapatma).
  //
  // `e.repeat` elenir: tuş basılı tutulduğunda tarayıcı saniyede onlarca keydown
  // üretir. Satış diyaloğu açıkken de çalışmaz — kasiyer "Yeni Satış"a basmadan
  // önce F2'ye dokunursa boş sepetle ikinci bir istek gitmesin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F2" || e.repeat) return
      if (lastSale !== null) return
      e.preventDefault()
      void handleComplete()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleComplete, lastSale])

  // autoPrint=true → pencere açılır açılmaz yazdırma diyaloğu gelir.
  const openReceipt = (autoPrint: boolean) => {
    if (!lastSale) return
    const w = window.open("", "_blank", "width=420,height=720")
    if (!w) {
      toast({
        title: "Açılır pencere engellendi",
        description: "Fiş için bu siteye açılır pencere izni verin.",
        variant: "destructive",
      })
      return
    }
    w.document.write(buildReceiptHtml(lastSale.receipt, autoPrint, receiptTemplate))
    w.document.close()
    w.focus()
  }

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const catTab = (isActive: boolean) =>
    cn(
      "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
      isActive
        ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/70"
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Kahveci Satış</h1>
          <p className="text-muted-foreground">
            Menüye bas, ödemeyi al, fişi yazdır. Reçeteli ürünlerin hammaddesi satışta otomatik düşer.
          </p>
        </div>
        {warehouses.length > 1 && (
          <div className="w-full sm:w-56">
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
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_400px]">
        {/* === SOL: menü === */}
        <div className="space-y-3">
          <Card>
            <CardContent className="space-y-3 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <CupSoda className="h-4 w-4 text-kobipo-blue dark:text-primary" />
                  <span className="text-sm font-semibold">Menü</span>
                  <span className="text-xs text-muted-foreground">
                    ({menuProducts.length} ürün · fiyatlar KDV dahil)
                  </span>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Ürün ara…"
                    className="h-10 pl-9"
                  />
                </div>
              </div>

              {categories.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setActiveCat(ALL_CATEGORIES)}
                    className={catTab(activeCat === ALL_CATEGORIES)}
                  >
                    Tümü
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setActiveCat(c)}
                      className={catTab(activeCat === c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {/* Yükleme ve hata durumu boş menüden AYRI: ürün listesi çekilemediğinde
                  "menüde ürün yok" demek kasiyeri yanıltır — menü dolu ama ekran boş. */}
              {productsError ? (
                <div className="py-12 text-center text-sm text-red-600 dark:text-red-400">
                  Menü yüklenemedi. Bağlantınızı kontrol edip sayfayı yenileyin.
                </div>
              ) : productsLoading && products.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Menü yükleniyor…</div>
              ) : visibleProducts.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {menuProducts.length === 0 ? (
                    // Kurulum artık tek yerde (Menü & Reçeteler) — iki ayrı yol
                    // tarif etmek yerine doğrudan oraya bağlıyoruz.
                    <>
                      Menüde ürün yok.{" "}
                      <Link
                        href="/restoran/menu"
                        className="font-semibold text-kobipo-blue underline-offset-4 hover:underline dark:text-primary"
                      >
                        Menü &amp; Reçeteler
                      </Link>{" "}
                      ekranından ürünlerinizi menüye alın.
                    </>
                  ) : (
                    "Bu aramaya/kategoriye uyan ürün yok"
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleProducts.map((p) => {
                    const inCart = cart.find((l) => l.productId === p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className={cn(
                          "relative flex min-h-[86px] flex-col justify-between gap-2 rounded-xl border-2 p-3 text-left transition-colors",
                          inCart
                            ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                            : "border-border hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                        )}
                      >
                        {inCart && (
                          <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-kobipo-blue px-1.5 text-xs font-bold text-white dark:bg-primary dark:text-primary-foreground">
                            {qty(inCart.quantity)}
                          </span>
                        )}
                        <span className="line-clamp-2 pr-7 text-sm font-semibold">{p.name}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-kobipo-blue dark:text-primary">
                            {p.salePrice != null ? currency(grossPrice(p)) : "—"}
                          </span>
                          {recipeMap.has(p.id) && (
                            <ChefHat
                              className="h-3.5 w-3.5 text-muted-foreground"
                              aria-label="Reçeteli"
                            />
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Kritik hammadde paneli */}
          {criticalStock.length > 0 && (
            <Card className="border-amber-300 dark:border-amber-700/60">
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <PackageMinus className="h-4 w-4" />
                  <span className="text-sm font-semibold">
                    Kritik hammadde ({criticalStock.length})
                  </span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {criticalStock.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs dark:bg-amber-950/30"
                    >
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="shrink-0 tabular-nums text-amber-700 dark:text-amber-400">
                        {qty(Number(p.stockQuantity ?? 0))} / {qty(Number(p.minStockLevel))} {p.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* === SAĞ: sepet + ödeme === */}
        <div className="space-y-3 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <Card>
            <CardContent className="space-y-3 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Sepet</span>
                  <span className="text-xs text-muted-foreground">({cart.length} kalem)</span>
                </div>
                {cart.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setCart([])}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Temizle
                  </Button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <ShoppingCart className="mx-auto mb-2 h-7 w-7 opacity-40" />
                  Menüden ürün seçin
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map((l) => (
                    <div
                      key={l.key}
                      className="flex items-center gap-2 rounded-lg border border-border p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {currency(l.unitPrice * (1 + l.vatRate / 100))} × {qty(l.quantity)}
                        </p>
                      </div>
                      <QuantityStepper
                        value={l.quantity}
                        onChange={(v) => setLineQty(l.key, v)}
                      />
                      <span className="w-20 shrink-0 text-right text-sm font-bold tabular-nums">
                        {currency(lineTotal(l))}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removeLine(l.key)}
                        title="Satırı sil"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Fiş notu (masa no, sipariş notu…)"
                className="h-9 text-sm"
              />
            </CardContent>
          </Card>

          {/* Yetersiz stok — uyarır, ENGELLEMEZ */}
          {(shortages.length > 0 || expandErrors.length > 0) && (
            <Card className="border-red-300 dark:border-red-700/60">
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-semibold">Stok yetersiz</span>
                </div>
                <div className="space-y-1.5">
                  {shortages.map((s) => (
                    <div key={s.productId} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{s.name}</span>
                        <span className="shrink-0 tabular-nums text-red-600 dark:text-red-400">
                          {qty(s.stock)} → {qty(s.after)} {s.unit}
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        Gereken {qty(s.need)} {s.unit}
                        {s.sources.length > 0 && ` · ${s.sources.join(", ")}`}
                      </p>
                    </div>
                  ))}
                  {expandErrors.map((e) => (
                    <p key={e} className="text-xs text-red-600 dark:text-red-400">
                      {e}
                    </p>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Satış engellenmez — stok eksiye düşebilir, girişini sonra yapabilirsiniz.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ödeme
              </Label>
              <PaymentPanel
                total={totals.total}
                state={payment}
                onChange={patchPayment}
                accounts={accounts}
              />
              {/* Perakende varsayılan: cari yalnız veresiyede sorulur. */}
              {payment.isCredit && (
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Müşteri — veresiye takibi için
                  </Label>
                  <div className="mt-1.5">
                    <CounterpartyCombobox
                      customers={customers}
                      suppliers={[]}
                      selectedCustomerId={customerId}
                      onSelect={(sel) =>
                        setCustomerId(sel && sel.kind === "customer" ? sel.id : undefined)
                      }
                      placeholder="Müşteri ara…"
                    />
                  </div>
                  {!customerId && (
                    <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                      Müşteri seçilmezse fiş ödenmemiş kalır ama kimseye borç yazılmaz.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

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
              {!payment.isCredit && summary.change > 0 && (
                <div className="flex justify-between px-1 text-sm">
                  <span className="text-muted-foreground">Para üstü</span>
                  <span className="font-bold tabular-nums text-kobipo-green">
                    {currency(summary.change)}
                  </span>
                </div>
              )}
              {summary.remaining > 0.005 && (
                <div className="flex justify-between px-1 text-sm">
                  <span className="text-muted-foreground">Açık kalan</span>
                  <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {currency(summary.remaining)}
                  </span>
                </div>
              )}
              <Button
                className="mt-1 h-14 w-full text-base"
                variant="success"
                onClick={handleComplete}
                disabled={isSubmitting || cart.length === 0}
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
                İpucu:{" "}
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">F2</kbd>{" "}
                ile satışı tamamla
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={lastSale !== null} onOpenChange={(open) => !open && setLastSale(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-kobipo-green" />
              Satış tamamlandı
            </DialogTitle>
            <DialogDescription>
              {lastSale?.invoiceNo ? `${lastSale.invoiceNo} oluşturuldu.` : "Fiş oluşturuldu."} Fişi
              yazdırabilir ya da doğrudan yeni satışa geçebilirsiniz.
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

/** Stok Decimal(14,4) — karşılaştırmadaki float artıklarını temizler. */
function round4(n: number) {
  return Math.round(n * 10_000) / 10_000
}
