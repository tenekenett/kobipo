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
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PackageMinus,
  Percent,
  Printer,
  Receipt,
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
import { MenuGrid } from "@/components/restoran/menu-grid"
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
  emptyPaymentState,
  paymentLabelOf,
  paymentSummary,
  receiptParts,
  round2,
  type PaymentState,
} from "@/lib/satis/payment"
import { TicketPanel } from "@/components/restoran/ticket-panel"
import { OptionDialog } from "@/components/restoran/option-dialog"
import { DiscountDialog, type DiscountValue } from "@/components/restoran/discount-dialog"
import { useProductOptions } from "@/lib/swr/use-restoran"
import { submitReceiptSale } from "@/lib/satis/submit-receipt-sale"
import { expandRecipeLines } from "@/lib/stock/recipe-expand"

type CafeLine = {
  key: string
  productId: string
  name: string
  unit: string
  /** KDV hariç birim fiyat — fatura API'si net bekliyor. Seçenek farkı buna dahildir. */
  unitPrice: number
  vatRate: number
  quantity: number
  /** Seçilen porsiyon/seçenekler — fişte ve sepette ürün adının altında görünür. */
  options?: Array<{ groupName: string; optionName: string; priceDelta: number }>
  note?: string | null
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`

/** Fişte/panelde görünen ad: "Latte · Büyük · Soya sütü · az şekerli". */
const describeLine = (l: CafeLine) =>
  [l.name, (l.options ?? []).map((o) => o.optionName).join(" · "), l.note]
    .filter(Boolean)
    .join(" · ")

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
  const { groupsOf } = useProductOptions(companyId)

  const [cart, setCart] = useState<CafeLine[]>([])
  const [optionFor, setOptionFor] = useState<RefProduct | null>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [discount, setDiscount] = useState<DiscountValue>(null)
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

  // ---- Sepet ----

  /**
   * Sepete ekler. Seçenek farkı KDV DAHİL girildiği için net'e çevrilip birim
   * fiyata bineriyor (adisyon ucundaki hesabın istemci tarafı karşılığı).
   */
  const addLine = useCallback(
    (
      product: RefProduct,
      extra?: {
        options?: Array<{ groupName: string; optionName: string; priceDelta: number }>
        note?: string | null
      },
    ) => {
      const vatRate = Number(product.vatRate) || 0
      const grossDelta = (extra?.options ?? []).reduce((s, o) => s + o.priceDelta, 0)
      const unitPrice =
        (product.salePrice != null ? Number(product.salePrice) : 0) + grossDelta / (1 + vatRate / 100)
      const optionKey = (extra?.options ?? []).map((o) => o.optionName).join("|")

      setCart((prev) => {
        // Birleştirme yalnız GERÇEKTEN aynı satırda: farklı seçenek = farklı satır.
        const idx = prev.findIndex(
          (l) =>
            l.productId === product.id &&
            (l.options ?? []).map((o) => o.optionName).join("|") === optionKey &&
            (l.note ?? null) === (extra?.note ?? null),
        )
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
            unitPrice,
            vatRate,
            quantity: 1,
            options: extra?.options,
            note: extra?.note ?? null,
          },
        ]
      })
    },
    [],
  )

  /** Seçeneği olan ürün diyalog açar; olmayan TEK DOKUNUŞTA sepete girer. */
  const addProduct = useCallback(
    (product: RefProduct) => {
      if (groupsOf(product.id).length > 0) {
        setOptionFor(product)
        return
      }
      addLine(product)
    },
    [addLine, groupsOf],
  )

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

  /**
   * İskonto sepetin TAMAMINA, KDV dahil tutar üzerinden uygulanır; faturaya
   * matrah karşılığı (`netDiscount`) gider — adisyon ekranındaki kuralın aynısı
   * (lib/restoran/ticket-constants.ts `ticketTotals`).
   */
  const totals = useMemo(() => {
    const raw = cartTotals(cart)
    const gross = round2(raw.total)
    const discountGross = !discount
      ? 0
      : discount.type === "PERCENT"
        ? round2(gross * (Math.min(100, Math.max(0, discount.value)) / 100))
        : round2(Math.min(discount.value, gross))
    const netDiscount = gross > 0 ? round2(discountGross * (raw.net / gross)) : 0
    return {
      net: round2(raw.net),
      vat: round2(raw.vat),
      gross,
      discount: discountGross,
      netDiscount,
      total: round2(gross - discountGross),
    }
  }, [cart, discount])

  const summary = paymentSummary(payment, totals.total)

  const discountLabel = !discount
    ? null
    : [discount.type === "PERCENT" ? `İskonto %${discount.value}` : "İskonto", discount.reason]
        .filter(Boolean)
        .join(" · ")

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
    setDiscount(null)
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
    const t = totals
    submitLock.current = true
    setIsSubmitting(true)
    try {
      // Fiş kesme + tahsilat akışı Adisyon ekranıyla ORTAK
      // (lib/satis/submit-receipt-sale.ts): tutarın SUNUCUNUN yazdığı toplamdan
      // gelmesi gibi ayrıntılar iki ekranda ayrışmasın.
      const result = await submitReceiptSale({
        companyId,
        items: snapshot.map((l) => ({
          productId: l.productId,
          description: describeLine(l),
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
        })),
        payment,
        accounts,
        customerId,
        warehouseId,
        notes: note,
        globalDiscountAmount: t.netDiscount,
        fallbackTotal: t.total,
      })

      if (!result.ok) {
        if (result.stage === "payment") {
          // Fiş oluştu, stok düştü — geri almak yerine kullanıcıyı uyar: tahsilat
          // Fişler ekranından tamamlanabilir, fişi silmek stoğu da geri alırdı.
          toast({
            title: "Fiş oluştu, tahsilat kaydedilemedi",
            description: result.error,
            variant: "destructive",
          })
          setIsSubmitting(false)
          return
        }
        throw new Error(result.error)
      }

      const { invoice, parts, paidSum, total: invoiceTotal } = result
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
          description: describeLine(l),
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
        discount: t.discount > 0 ? { label: discountLabel ?? "İskonto", amount: t.discount } : null,
        paymentLabel: payment.isCredit
          ? "Veresiye"
          : paymentLabelOf(payment.method, payment.provider),
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
    totals,
    discountLabel,
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
          {/* Izgara Adisyon ekranıyla ORTAK (components/restoran/menu-grid.tsx):
              "menüde ne görünür" sorusunun iki ekranda ayrışmaması için. */}
          <MenuGrid
            products={products}
            recipeMap={recipeMap}
            isLoading={productsLoading}
            error={productsError}
            badgeOf={(productId) => cart.find((l) => l.productId === productId)?.quantity ?? null}
            onPick={addProduct}
          />

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
          {/* Sepet paneli Adisyon ekranıyla ORTAK (components/restoran/ticket-panel.tsx):
              kalem satırında tek kontrol (⋮), toplam bloğunda tek satır. */}
          <TicketPanel
            title="Sepet"
            items={cart.map((l) => ({
              id: l.key,
              description: l.name,
              note: l.note,
              options: l.options,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              vatRate: l.vatRate,
              status: "NORMAL" as const,
            }))}
            totals={totals}
            discountLabel={discountLabel}
            // Kahveci ekranında ikram/zayi YOK: satış henüz oluşmadı, malzeme
            // harcanmadı. Yanlış giren satır silinir.
            allowStatus={false}
            className="xl:static"
            onQuantity={(id, q) => setLineQty(id, q)}
            footer={
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cart.length === 0}
                    onClick={() => setDiscountOpen(true)}
                  >
                    <Percent className="mr-1.5 h-4 w-4" />
                    İskonto
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={cart.length === 0}
                    onClick={() => setCart([])}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Temizle
                  </Button>
                </div>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="Fiş notu (masa no, sipariş notu…)"
                  className="h-9 text-sm"
                />
              </div>
            }
          />

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
      {/* Seçenek / porsiyon — yalnız tanımlı üründe açılır */}
      <OptionDialog
        open={!!optionFor}
        productName={optionFor?.name ?? ""}
        basePrice={
          optionFor
            ? Number(optionFor.salePrice ?? 0) * (1 + (Number(optionFor.vatRate) || 0) / 100)
            : 0
        }
        groups={optionFor ? groupsOf(optionFor.id) : []}
        onCancel={() => setOptionFor(null)}
        onConfirm={(pick) => {
          const product = optionFor
          setOptionFor(null)
          if (!product) return
          const picked = groupsOf(product.id)
            .flatMap((g) =>
              g.options
                .filter((o) => pick.optionIds.includes(o.id))
                .map((o) => ({
                  groupName: g.name,
                  optionName: o.name,
                  priceDelta: o.priceDelta,
                })),
            )
          addLine(product, { options: picked, note: pick.note })
        }}
      />

      {/* İskonto */}
      <DiscountDialog
        open={discountOpen}
        gross={totals.gross}
        current={discount}
        onClose={() => setDiscountOpen(false)}
        onApply={(v) => {
          setDiscount(v)
          setDiscountOpen(false)
        }}
      />

    </div>
  )
}

/** Stok Decimal(14,4) — karşılaştırmadaki float artıklarını temizler. */
function round4(n: number) {
  return Math.round(n * 10_000) / 10_000
}
