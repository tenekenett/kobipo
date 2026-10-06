"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import {
  ProductCombobox,
  type ComboboxProduct,
  type ProductComboboxHandle,
} from "@/components/e-donusum/product-combobox"
import { CounterpartyCombobox } from "@/components/e-donusum/counterparty-combobox"
import { PaymentPanel, type PaymentShortcuts } from "@/components/satis/payment-panel"
import { FullscreenButton, Kbd, RecentDocBar, anyDialogOpen, type RecentDoc } from "@/components/satis/counter-ui"
import { PriceCheckDialog } from "@/components/satis/price-check-dialog"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import {
  useProducts,
  useCustomers,
  useAccounts,
  useWarehouses,
  useProductCategories,
  useReceiptTemplate,
  useWarehouseStocks,
  useRecipes,
} from "@/lib/swr/use-company-data"
import { cn } from "@/lib/utils"
import {
  defaultPaymentAccounts,
  emptyPaymentState,
  parseAmount,
  paymentLabelOf,
  paymentSummary,
  portionsTotal,
  receiptParts,
  withMethodChannel,
  type PaymentMethod,
  type PaymentState,
} from "@/lib/satis/payment"
import { submitReceiptSale } from "@/lib/satis/submit-receipt-sale"
import {
  applyTicketDiscount,
  emptyTicketDiscount,
  ticketDiscountLabel,
  type TicketDiscount,
} from "@/lib/satis/ticket-discount"
import { withAccountNote } from "@/lib/finans/hesapsiz-odeme"
import { formatMoney } from "@/lib/format"
import { useTryPrice } from "@/lib/exchange/use-try-price"
import {
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Package,
  Plus,
  Printer,
  Receipt,
  Search,
  Share2,
  ShoppingCart,
  Tag,
  Trash2,
  Undo2,
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

// Ödeme kutusu Kahveci Satış'la ORTAK (components/satis/payment-panel.tsx +
// lib/satis/submit-receipt-sale.ts). Yemek kartı kafeye özgü ödeme tipi —
// tezgâhta gösterilmez.
const QUICK_SALE_METHODS: PaymentMethod[] = ["CASH", "CREDIT_CARD", "BANK_TRANSFER"]
const QUICK_CASH = [20, 50, 100, 200]

// Tek tuşla ödeme: yöntemi seçer VE satışı tamamlar (F2 seçili yöntemle tamamlar).
type QuickPay = "CASH" | "CREDIT_CARD" | "CREDIT"
const PAY_KEYS: Record<string, QuickPay> = { F8: "CASH", F9: "CREDIT_CARD", F10: "CREDIT" }
const PAY_SHORTCUTS: PaymentShortcuts = { CASH: "F8", CREDIT_CARD: "F9", CREDIT: "F10" }

// Aynı anda açık tutulabilen park edilmiş satış (müşteri) sayısı.
const NUM_TICKETS = 8
const ALL_CATEGORIES = "__ALL__"

// Önceki fiyatlar (geçmiş) modalı — /api/stok/products/[id]/prices yanıtı.
type PriceRow = { date: string; cariName: string; price: number }
type PriceHistory = { sales: PriceRow[]; customerSales: PriceRow[]; purchases: PriceRow[]; quotes: PriceRow[] }
type PriceTab = keyof PriceHistory
const EMPTY_PRICE_HISTORY: PriceHistory = { sales: [], customerSales: [], purchases: [], quotes: [] }
const PRICE_TABS: { key: PriceTab; label: string }[] = [
  { key: "sales", label: "Önceki Satışlar" },
  { key: "purchases", label: "Önceki Alışlar" },
]

// note: satış anında girilen kısa fiş notu (fişe basılır). Not ve ödeme
// Ticket'ta tutulur ki park edilen satışlar arasında geçiş yapınca kaybolmasın.
// `payment.accountId` boşsa firmanın varsayılan kasası kullanılır (bkz. `payment`).
//
// isReturn: "İade modu" — sepetin TAMAMI müşteriden geri alınır. Fiş `RETURN`
// (satış iadesi) kesilir: stok girer, ödeme parçaları müşteriye ÖDENİR (kasadan
// çıkar), veresiye müşterinin ALACAĞINA yazılır. Satış ve iade aynı fişte
// karışmaz (değişim = önce iade, sonra satış): karışık bir belgenin KDV'si,
// stoğu ve kasası tek işaretle yazılamaz. Satış bitince kip kapanır.
// discount: fiş altı iskonto (KDV dahil tutar ya da yüzde) — lib/satis/ticket-discount.ts.
type Ticket = {
  cart: CartLine[]
  customerId?: string
  note: string
  payment: PaymentState
  isReturn: boolean
  discount: TicketDiscount
}
const emptyTicket = (): Ticket => ({
  cart: [],
  customerId: undefined,
  note: "",
  payment: emptyPaymentState(),
  isReturn: false,
  discount: emptyTicketDiscount(),
})

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


export function QuickSaleScreen() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  const companyId = selectedCompanyId
  const { toast } = useToast()
  // Ürün kartı USD/EUR fiyat tutabilir, fiş ise TRY kesilir (aşağıdaki
  // `currency: "TRY"`); dönüşüm sepete eklerken yapılır. Kur alınamazsa fiyat 0
  // kalır ve kullanıcı uyarılır — bkz. lib/exchange/use-try-price.ts.
  const { toTRY } = useTryPrice()

  // Referans veriler SWR ile önbelleklenir: ekranlar arası paylaşılır ve her
  // mount'ta yeniden çekilmez (aynı anahtar 30 sn içinde dedupe edilir).
  const { products: refProducts } = useProducts(companyId, { isService: false })
  const { customers, mutate: mutateCustomers } = useCustomers(companyId)
  const { accounts, mutate: mutateAccounts } = useAccounts(companyId)
  const { warehouses } = useWarehouses(companyId)
  const { categories: categoryOptions } = useProductCategories(companyId)
  const { stocks: warehouseStocks } = useWarehouseStocks(companyId)
  // Reçeteli ürün (latte) SANALDIR: kendi stoğu tutulmaz, satışta hammaddesi düşer.
  // Sepetteki stok bilgisi bu ürünlerde gösterilmez (bkz. availableStock).
  const { recipeMap } = useRecipes(companyId)
  // Fiş tasarımı + firma künyesi (Ayarlar > Fiş Tasarımı); kaydedilmemişse varsayılan gelir.
  const { template: receiptTemplate, company: receiptCompany } = useReceiptTemplate(companyId)
  const [warehouseId, setWarehouseId] = useState<string>("")
  // Satış bağlamı: satır/kutucuk birim fiyatı ürünün SATIŞ fiyatından gelir.
  const products: QuickProduct[] = refProducts

  // Park edilen satışlar (Müşteri 1..N). Her biri kendi sepeti + müşterisi + ödenen tutarı.
  const [tickets, setTickets] = useState<Ticket[]>(() =>
    Array.from({ length: NUM_TICKETS }, emptyTicket)
  )
  const [activeTicket, setActiveTicket] = useState(0)
  const active = tickets[activeTicket]

  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)
  const [miscAmount, setMiscAmount] = useState("")

  const [isSubmitting, setIsSubmitting] = useState(false)
  /**
   * Çift satış kilidi (Kahveci Satış'taki kuralın aynısı). `isSubmitting` state'i
   * tek başına yetmiyor: F2 basılı tutulduğunda ya da düğmeye çift tıklandığında
   * iki çağrı da aynı render'da geçebilir. Sonuç iki fiş, iki stok düşümü, iki
   * tahsilat olurdu. Ref senkron okunup yazılır.
   */
  const submitLock = useRef(false)
  /**
   * Eksik tahsilat onayı: müşteri seçilmeden veresiye ya da eksik parçalı ödeme
   * yapılırsa açık kalan tutar KİMSEYE borç yazılmaz. Sessiz geçilmez, sorulur.
   */
  const [shortPayWarn, setShortPayWarn] = useState<number | null>(null)
  const shortPayAcked = useRef(false)
  /** Barkod kutusu — her eklemeden ve satıştan sonra odak buraya döner. */
  const scanRef = useRef<ProductComboboxHandle>(null)
  /** Son işlem satırı — satış penceresi kapandıktan sonra da durur (yeniden yazdırma için). */
  const [recent, setRecent] = useState<(RecentDoc & { receipt: ReceiptData; isReturn: boolean }) | null>(null)
  /** F7 — fiyat gör / ayrıntılı arama penceresi. */
  const [priceCheckOpen, setPriceCheckOpen] = useState(false)
  const [lastSale, setLastSale] = useState<
    { id: string; invoiceNo?: string | null; isEArsiv: boolean; receipt: ReceiptData } | null
  >(null)
  // Tutar sütununda düzenlenen satır (yazarken alanın kullanıcıyla çakışmasını önler).
  const [totalEdit, setTotalEdit] = useState<{ key: string; value: string } | null>(null)
  // Fiyat sütununda düzenlenen satır — birim fiyat 6 ondalık olabildiğinden (Tutar'dan
  // geri hesaplanınca) alan odak dışıyken 2 ondalıkla gösterilir, yazarken ham girişi korur.
  const [priceEdit, setPriceEdit] = useState<{ key: string; value: string } | null>(null)

  // Önceki fiyatlar (geçmiş) modalı.
  const [priceModalLine, setPriceModalLine] = useState<CartLine | null>(null)
  const [activePriceTab, setActivePriceTab] = useState<PriceTab>("sales")
  const [priceHistory, setPriceHistory] = useState<PriceHistory>(EMPTY_PRICE_HISTORY)
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false)

  // Varsayılan depo (Ana) ve kasa/banka hesabı — referans veriler gelince bir kez seç.
  useEffect(() => {
    if (warehouseId || warehouses.length === 0) return
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0]
    if (def) setWarehouseId(def.id)
  }, [warehouses, warehouseId])

  // FİRMA DEĞİŞİNCE depo seçimi sıfırlanır. Yukarıdaki varsayılan-seçme etkisi
  // yalnız alan BOŞKEN çalışıyor: sıfırlamazsak panelde firma değiştirildiğinde
  // eski firmanın depo id'si state'te kalır ve satış onun deposuna yazılırdı
  // (sunucu da artık reddedip varsayılana düşüyor, bkz. resolveCompanyWarehouseId).
  // Bekleyen satışlar da sıfırlanır: sepet eski firmanın ürünlerini, ödeme eski
  // firmanın kasa/banka hesabını taşır.
  useEffect(() => {
    setWarehouseId("")
    setTickets(Array.from({ length: NUM_TICKETS }, emptyTicket))
    setActiveTicket(0)
    setRecent(null)
  }, [companyId])

  // Ödeme kanalları — kural Kahveci Satış ve sunucu kapanışıyla ortak.
  const channelIds = useMemo(() => defaultPaymentAccounts(accounts), [accounts])
  const defaultAccountId = channelIds.cashAccountId ?? accounts[0]?.id ?? ""
  // Aktif satışın ödemesi; hesap seçilmemişse varsayılan kasa.
  const payment = useMemo<PaymentState>(
    () => ({ ...active.payment, accountId: active.payment.accountId || defaultAccountId }),
    [active.payment, defaultAccountId]
  )

  /** Barkod kutusuna dön. Telefonda klavyeyi kendiliğinden açmasın diye yalnız fareli ekranda. */
  const focusScan = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches) return
    scanRef.current?.focus()
  }, [])
  useEffect(() => {
    focusScan()
  }, [companyId, focusScan])
  // Bir pencere açılınca barkod listesi kapanır: liste pencerenin ÜSTÜNDE kalıyordu
  // (Chrome denemesi, 2026-10-06 — kutuya tıklanıp F7'ye basılınca).
  const anyScreenDialog = priceCheckOpen || lastSale !== null || shortPayWarn !== null || priceModalLine !== null
  useEffect(() => {
    if (anyScreenDialog) scanRef.current?.close()
  }, [anyScreenDialog])

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
  const patchPayment = useCallback(
    (patch: Partial<PaymentState>) => {
      setTickets((prev) =>
        prev.map((t, i) => (i === activeTicket ? { ...t, payment: { ...t.payment, ...patch } } : t))
      )
    },
    [activeTicket]
  )

  /** Ürün satış fiyatının TL karşılığı (kural: lib/exchange/use-try-price.ts). */
  const priceInTRY = useCallback(
    (product: ComboboxProduct): number =>
      toTRY(product.salePrice != null ? Number(product.salePrice) : 0, product.currency, product.name),
    [toTRY]
  )

  const addProductToCart = useCallback(
    (product: ComboboxProduct, opts?: { quantity?: number }) => {
      // "3*barkod" ile gelen miktar; yoksa 1.
      const qty = opts?.quantity && opts.quantity > 0 ? opts.quantity : 1
      if (product.id) {
        const best = bestWarehouseByProduct.get(product.id)
        if (best) setWarehouseId(best.warehouseId)
      }
      // Fiyat (ve çeviri uyarısı) yalnız satır İLK kez eklenirken hesaplanır; aynı
      // ürün tekrar okutulunca miktar artar, kur toast'ı her okutmada tekrarlanmaz.
      const inCart = !!product.id && active.cart.some((l) => l.productId === product.id)
      const unitPrice = inCart ? 0 : priceInTRY(product)
      patchCart((cart) => {
        if (product.id) {
          const idx = cart.findIndex((l) => l.productId === product.id)
          if (idx >= 0) {
            const next = [...cart]
            next[idx] = { ...next[idx], quantity: next[idx].quantity + qty }
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
            quantity: qty,
            unitPrice,
            vatRate: Number(product.vatRate) || 0,
          },
        ]
      })
    },
    [active.cart, bestWarehouseByProduct, patchCart, priceInTRY]
  )

  const addMisc = useCallback(() => {
    const amt = parseAmount(miscAmount)
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
  // Fiş altı iskonto: ödenecek tutar iskontodan SONRAKİ toplamdır.
  const discountValue = parseAmount(active.discount.value)
  const disc = useMemo(
    () => applyTicketDiscount(totals, active.discount.type, discountValue),
    [totals, active.discount.type, discountValue]
  )
  const payTotal = disc.total
  const summary = paymentSummary(payment, payTotal)
  const isReturn = active.isReturn
  // Seçili müşterinin bakiyesi (liste ucunun hesabı; işlemden sonra tazelenir).
  const selectedCustomerBalance = active.customerId
    ? customers.find((c) => c.id === active.customerId)?.balance ?? null
    : null
  // "Ödenen" kutusu: nakitte müşterinin verdiği, parçalıda girilen toplam, kart/
  // havalede tutarın tamamı, veresiyede 0. İadede müşteriye ÖDENEN: verilen
  // para yok, nakit iade de tutarın tamamıdır.
  const paidDisplay = payment.isCredit
    ? 0
    : payment.splitMode
      ? portionsTotal(payment.portions)
      : payment.method === "CASH" && !isReturn
        ? parseAmount(payment.tendered)
        : payTotal

  /** İade modunu aç/kapat. Nakit kutusu iadede anlamsız (para veren yok) — temizlenir. */
  const toggleReturn = useCallback(() => {
    setTickets((prev) =>
      prev.map((t, i) =>
        i === activeTicket
          ? { ...t, isReturn: !t.isReturn, payment: { ...t.payment, tendered: "" } }
          : t
      )
    )
    shortPayAcked.current = false
  }, [activeTicket])

  // Önceki fiyatlar (geçmiş) modalını aç ve ürünün fiyat geçmişini çek.
  const openPriceHistory = useCallback(
    async (line: CartLine) => {
      if (!line.productId || !companyId) return
      setPriceModalLine(line)
      setActivePriceTab("sales")
      setPriceHistory(EMPTY_PRICE_HISTORY)
      setPriceHistoryLoading(true)
      try {
        const qs = new URLSearchParams({ companyId })
        if (active.customerId) qs.set("customerId", active.customerId)
        const res = await fetch(`/api/stok/products/${line.productId}/prices?${qs.toString()}`)
        if (res.ok) setPriceHistory(await res.json())
      } catch (error) {
        console.error("Fiyat geçmişi çekilemedi:", error)
      } finally {
        setPriceHistoryLoading(false)
      }
    },
    [companyId, active.customerId]
  )
  const applyHistoryPrice = (price: number) => {
    if (priceModalLine) updateLine(priceModalLine.key, { unitPrice: price })
    setPriceModalLine(null)
  }

  // Sepet satırında stok bilgisi: SEÇİLİ depodaki miktar. Stok hiç girilmemiş
  // ürün (depo satırı yok, toplam 0) için null — stok takibi yapmayan işletmede
  // her satır uyarıya dönerdi. Satış ENGELLENMEZ; yalnız kasiyer görür.
  const stockIndex = useMemo(() => {
    const byKey = new Map<string, number>()
    const tracked = new Set<string>()
    for (const s of warehouseStocks) {
      byKey.set(`${s.productId}:${s.warehouseId}`, s.quantity)
      tracked.add(s.productId)
    }
    return { byKey, tracked }
  }, [warehouseStocks])
  const productById = useMemo(() => new Map(refProducts.map((p) => [p.id, p])), [refProducts])
  const availableStock = useCallback(
    (productId: string | null): number | null => {
      if (!productId || recipeMap.has(productId)) return null
      if (stockIndex.tracked.has(productId)) return stockIndex.byKey.get(`${productId}:${warehouseId}`) ?? 0
      const total = Number(productById.get(productId)?.stockQuantity ?? 0)
      return total !== 0 ? total : null
    },
    [stockIndex, productById, warehouseId, recipeMap]
  )
  const stockHint = (line: CartLine) => {
    const avail = availableStock(line.productId)
    if (avail == null) return null
    const short = !isReturn && line.quantity > avail
    return (
      <span className={cn("text-[11px]", short ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        Stok: {avail.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} {line.unit}
        {short ? " — yetersiz, stok eksiye düşer" : ""}
      </span>
    )
  }

  const productCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category) set.add(p.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"))
  }, [products])

  // Hızlı ürün tuşlarında yalnız satılabilir ürünler: kahvecide "Süt"/"Kahve
  // Çekirdeği" gibi hammaddeler (isSellable=false) menüde satılacak kalem değil.
  // Arama/barkod kutusu (ProductCombobox) tümünü göstermeye devam eder — hammadde
  // bilinçli olarak satılmak istenirse oradan bulunur.
  const quickProducts = useMemo(() => {
    const list = refProducts.filter(
      (p) => p.isSellable && (activeCat === ALL_CATEGORIES || p.category === activeCat)
    )
    return list.slice(0, 60)
  }, [refProducts, activeCat])

  const resetSale = useCallback(() => {
    setTickets((prev) => prev.map((t, i) => (i === activeTicket ? emptyTicket() : t)))
    // Onay bu satışa aitti — sonraki satışta yeniden sorulur.
    shortPayAcked.current = false
  }, [activeTicket])

  /**
   * Satışı tamamlar. `override` tek tuşla ödemeden gelir (F8/F9/F10): state
   * güncellemesi bu çağrıda henüz görünmediği için seçilen yöntem buradan
   * birleştirilir.
   */
  const handleComplete = useCallback(
    async (override?: Partial<PaymentState>) => {
      if (!companyId) {
        toast({ title: "Hata", description: "Firma seçili değil", variant: "destructive" })
        return
      }
      if (submitLock.current) return
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
      const tkDiscountValue = parseAmount(tk.discount.value)
      const d = applyTicketDiscount(t, tk.discount.type, tkDiscountValue)
      const pay: PaymentState = override ? { ...payment, ...override } : payment

      // Açık kalan tutar (veresiye ya da eksik parçalı ödeme) müşteri yoksa
      // kimseye borç yazılmaz — önce sorulur.
      const pending = paymentSummary(pay, d.total)
      if (pending.remaining > 0.005 && !tk.customerId && !shortPayAcked.current) {
        setShortPayWarn(pending.remaining)
        return
      }

      submitLock.current = true
      setIsSubmitting(true)
      try {
        // Hızlı satış FİŞ keser (resmî fatura değil): daima MANUAL, GİB'e gönderim
        // yok. Stok + tahsilat anında işler. Fiş, "Fişler" listesinden toplu faturaya
        // dönüştürülebilir; e-Arşiv/e-Fatura yalnız dönüştürülen faturada seçilir.
        // Fiş + tahsilat akışı Kahveci Satış ve Adisyonla ORTAK: tahsilat tutarı
        // faturanın SUNUCUDA kayıtlı toplamından hesaplanır.
        const result = await submitReceiptSale({
          companyId,
          items: cart.map((l) => ({
            productId: l.productId,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
          })),
          payment: pay,
          accounts,
          customerId: tk.customerId,
          warehouseId,
          notes: tk.note,
          // İskonto matrahtan düşer (NET); sunucu belgeyi buna göre kurar ve
          // tahsilat sunucunun toplamından hesaplanır.
          globalDiscountAmount: d.net > 0 ? d.net : null,
          fallbackTotal: d.total,
          isReturn: tk.isReturn,
        })

        if (!result.ok) {
          if (result.stage === "payment") {
            // Fiş oluştu, stok düştü — geri almak yerine uyar: tahsilat Fişler
            // ekranından tamamlanabilir, fişi silmek stoğu da geri alırdı.
            toast({
              title: tk.isReturn ? "İade fişi oluştu, ödeme kaydedilemedi" : "Fiş oluştu, tahsilat kaydedilemedi",
              description: result.error,
              variant: "destructive",
            })
            return
          }
          throw new Error(result.error)
        }

        // Fiş kesildi ama stok yazılamadıysa sunucu uyarı döner (satış bloklanmaz).
        // Söylenmezse kasiyer bunu ancak gün sonunda tutmayan stokta fark ederdi.
        if (result.invoice?.stockWarning) {
          toast({
            title: "Stok güncellenemedi",
            description: String(result.invoice.stockWarning),
            variant: "destructive",
          })
        }

        const { invoice, parts, paidSum, total: invoiceTotal, accountNote } = result
        const done = paymentSummary(pay, invoiceTotal)
        // Hesap seçilmeden yazılan parça varsayılan Kasa'ya düştü: söyle, ve kasa
        // yeni açıldıysa listeyi tazele ki sonraki satış onu AÇIKÇA seçsin.
        if (accountNote) void mutateAccounts()
        toast({
          title: tk.isReturn ? "İade tamamlandı" : "Satış tamamlandı",
          description: withAccountNote(
            `${invoice.invoiceNo ?? "Fiş"} oluşturuldu${
              tk.isReturn
                ? pay.isCredit
                  ? " (müşterinin alacağına yazıldı)"
                  : ` • ${currency(paidSum)} müşteriye ödendi`
                : pay.isCredit
                  ? " (veresiye)"
                  : ` • ${currency(paidSum)} tahsil edildi`
            }`,
            accountNote,
          ),
        })

        // Fiş için satışın anlık görüntüsü — sepet birazdan sıfırlanacağı için burada al.
        // Toplamlar faturanın sunucudaki değerleriyle hizalı olsun (fiş = fatura).
        const receipt: ReceiptData = {
          direction: "outgoing",
          invoiceNo: invoice.invoiceNo ?? null,
          date: new Date().toISOString(),
          companyName: selectedCompany?.name ?? "",
          company: receiptCompany,
          counterpartyName: tk.customerId ? customers.find((c) => c.id === tk.customerId)?.name ?? null : null,
          notes: tk.note.trim() || null,
          items: cart.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            total: lineTotals(l).total,
          })),
          net: invoice?.netAmount != null ? Number(invoice.netAmount) : t.net,
          vat: invoice?.vatAmount != null ? Number(invoice.vatAmount) : t.vat,
          total: invoiceTotal,
          discount: d.gross > 0 ? { label: ticketDiscountLabel(tk.discount.type, tkDiscountValue), amount: d.gross } : null,
          // Parçalı ödemede döküm `parts`ta; buradaki etiket tek yöntemli satışın başlığı.
          paymentLabel: pay.isCredit
            ? tk.isReturn
              ? "Cariye alacak"
              : "Veresiye"
            : paymentLabelOf(pay.method, pay.provider),
          tendered: done.tendered,
          change: done.change,
          isCredit: pay.isCredit,
          parts: pay.splitMode && !pay.isCredit ? receiptParts(parts) : undefined,
          isReturn: tk.isReturn,
        }
        setLastSale({ id: invoice.id, invoiceNo: invoice.invoiceNo, isEArsiv: false, receipt })
        setRecent({
          id: invoice.id,
          invoiceNo: invoice.invoiceNo,
          total: invoiceTotal,
          paymentLabel: pay.splitMode && !pay.isCredit ? "Parçalı" : receipt.paymentLabel,
          change: done.change,
          receipt,
          isReturn: tk.isReturn,
        })
        // Müşterili işlemde cari bakiyesi değişti: seçicideki bakiye tazelensin.
        if (tk.customerId) void mutateCustomers()
        resetSale()
      } catch (error: any) {
        toast({ title: "Hata", description: error?.message || "Satış tamamlanamadı", variant: "destructive" })
      } finally {
        // Tahsilat hatasında try içinden dönülse bile burası çalışır — kilit tek yerde açılır.
        submitLock.current = false
        setIsSubmitting(false)
      }
    },
    [
      companyId,
      tickets,
      activeTicket,
      payment,
      accounts,
      warehouseId,
      toast,
      resetSale,
      customers,
      selectedCompany,
      receiptCompany,
      mutateAccounts,
      mutateCustomers,
    ]
  )

  /**
   * Tek tuşla ödeme: yöntemi ekranda da seçer, sonra satışı tamamlar. Hesap,
   * paneldeki yöntem düğmesiyle AYNI kuralla o yöntemin kanalına geçer.
   */
  const quickPay = useCallback(
    (kind: QuickPay) => {
      const patch: Partial<PaymentState> =
        kind === "CREDIT"
          ? { isCredit: true, splitMode: false }
          : withMethodChannel(
              { method: kind, isCredit: false, splitMode: false, ...(kind !== "CASH" ? { tendered: "" } : {}) },
              channelIds
            )
      patchPayment(patch)
      void handleComplete(patch)
    },
    [patchPayment, handleComplete, channelIds]
  )

  // F2 → seçili yöntemle tamamla; F8 nakit, F9 kart, F10 açık hesap (tek tuşla).
  //
  // `e.repeat` elenir: tuş basılı tutulduğunda tarayıcı saniyede onlarca keydown
  // üretir. Açık bir pencere varken (satış sonucu, ürün ekleme, eksik tahsilat
  // onayı) çalışmaz — pencerenin arkasında boş ya da yarım sepet kapanmasın.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F7 → fiyat gör (sepet boşken de çalışır).
      if (e.key === "F7") {
        e.preventDefault()
        if (!e.repeat && lastSale === null && !anyDialogOpen()) setPriceCheckOpen(true)
        return
      }
      const kind = e.key === "F2" ? "F2" : PAY_KEYS[e.key]
      if (!kind) return
      // F10 tarayıcının menüsünü açar; bu ekranda tuş bizimdir.
      e.preventDefault()
      if (e.repeat || lastSale !== null || shortPayWarn !== null || anyDialogOpen()) return
      if (active.cart.length === 0) return
      if (kind === "F2") void handleComplete()
      else quickPay(kind)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleComplete, quickPay, lastSale, shortPayWarn, active.cart.length])

  const previewUrl = (id: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/faturalar/${id}/onizleme?company=${companyId}`

  /** Son işlem satırından fişi yeniden yazdır (pencere kapandıktan sonra da). */
  const printRecent = () => {
    if (!recent) return
    const w = window.open("", "_blank", "width=420,height=720")
    if (!w) {
      toast({
        title: "Açılır pencere engellendi",
        description: "Fiş için bu site için açılır pencerelere izin verin.",
        variant: "destructive",
      })
      return
    }
    w.document.write(buildReceiptHtml(recent.receipt, true, receiptTemplate))
    w.document.close()
    w.focus()
  }

  const printSale = () => {
    if (!lastSale) return
    window.open(previewUrl(lastSale.id), "_blank", "noopener")
  }

  // autoPrint=false → ön gösterim sayfası (kullanıcı isterse oradan yazdırır)
  // autoPrint=true  → pencereyi açar açmaz yazdırma diyaloğunu getirir
  const openReceipt = (autoPrint: boolean) => {
    if (!lastSale) return
    const w = window.open("", "_blank", "width=420,height=720")
    if (!w) {
      toast({
        title: "Açılır pencere engellendi",
        description: "Fiş için bu site için açılır pencerelere izin verin.",
        variant: "destructive",
      })
      return
    }
    w.document.write(buildReceiptHtml(lastSale.receipt, autoPrint, receiptTemplate))
    w.document.close()
    w.focus()
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
      <RecentDocBar
        label={recent?.isReturn ? "Son iade" : "Son satış"}
        idleText="Satış bekleniyor"
        doc={recent}
        onPrint={printRecent}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setPriceCheckOpen(true)}
          title="Fiyat gör — ürün sepete eklenmez (F7)"
        >
          <Tag className="h-4 w-4" />
          <span className="hidden sm:inline">Fiyat gör</span>
          <Kbd>F7</Kbd>
        </Button>
        <FullscreenButton />
      </RecentDocBar>

      {/* Tutar / Ödenen / Para Üstü kutuları — iadede: iade tutarı / müşteriye
          ödenen / müşterinin alacağına yazılan (para üstü iadede olmaz). */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label={isReturn ? "İade Tutarı" : "Tutar"} value={currency(payTotal)} tone={isReturn ? "red" : "brand"} />
        <StatTile label={isReturn ? "İade Edilen" : "Ödenen"} value={currency(paidDisplay)} tone="blue" />
        {isReturn ? (
          <StatTile label="Cariye Alacak" value={currency(summary.remaining)} tone="amber" />
        ) : (
          <StatTile label="Para Üstü" value={currency(summary.change)} tone="green" />
        )}
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[1fr_380px]">
        {/* === SOL: barkod + park sekmeleri + sepet === */}
        {/* min-w-0: grid item'ın varsayılan min-width'i `auto`dur — içindeki geniş
            bir eleman (sepet tablosu, uzun ürün adı) sütunu ekran dışına taşırır ve
            sayfa yana kayar. Sıfırlanınca taşma kendi kabında kalır. */}
        <div className="min-w-0 space-y-3">
          {/* Barkod / ürün arama — EN ÜSTTE ve odakta: okuyucu kodu yazıp Enter'a
              basar, ürün sepete düşer, odak kutuda kalır (scanMode). Eskiden kutu
              sepetin altındaydı ve her seçimden sonra odağı bırakıyordu; ikinci
              okutma kutuya yeniden tıklanana kadar boşa gidiyordu. Sonuç listesi
              body'ye portal ile basılır, kartın overflow'u onu kırpmaz. */}
          <Card className="border-kobipo-blue/40 dark:border-primary/40">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Search className="h-5 w-5 shrink-0 text-kobipo-blue dark:text-primary" />
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
                    scanMode
                    handleRef={scanRef}
                    placeholder="Barkod okutun veya ürün adı yazın (3* ile miktar)"
                    inputClassName="h-11 text-base"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Park edilen müşteriler */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tickets.map((t, i) => {
              const tt = cartTotals(t.cart).total
              const cust = t.customerId ? customers.find((c) => c.id === t.customerId)?.name : null
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setActiveTicket(i)
                    shortPayAcked.current = false
                    focusScan()
                  }}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                    i === activeTicket
                      ? "border-kobipo-blue bg-kobipo-blue/10 dark:border-primary dark:bg-primary/15"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <span className="font-semibold">{cust || `Müşteri ${i + 1}`}</span>
                  {t.isReturn && (
                    <span className="rounded bg-red-100 px-1 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      İADE
                    </span>
                  )}
                  <span className="tabular-nums text-muted-foreground">{currency(tt)}</span>
                  {t.cart.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-kobipo-green" />}
                </button>
              )
            })}
          </div>

          <Card className={cn(isReturn && "border-2 border-red-400 dark:border-red-700")}>
            <CardContent className="space-y-3 p-3">
              {isReturn && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
                  <Undo2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>İade modu.</strong> Sepetteki ürünler müşteriden geri alınır ve stoğa girer;
                    tutar müşteriye ödenir ya da alacağına yazılır. Değişimde önce iadeyi, sonra yeni
                    satışı tamamlayın.
                  </span>
                </div>
              )}
              {/* Muhtelif tutar + iade modu + sepeti temizle */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{isReturn ? "İade Sepeti" : "Sepet"}</span>
                  <span className="text-xs text-muted-foreground">({active.cart.length} kalem)</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={isReturn}
                    onClick={() => {
                      toggleReturn()
                      focusScan()
                    }}
                    className={cn(
                      "gap-1.5",
                      isReturn
                        ? "border-red-500 bg-red-600 text-white hover:bg-red-700 hover:text-white dark:border-red-600"
                        : "border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                    )}
                    title={isReturn ? "İade modundan çık — normal satışa dön" : "Bu sepeti iade olarak kaydet"}
                  >
                    <Undo2 className="h-4 w-4" />
                    {isReturn ? "İade modu • Açık" : "İade modu"}
                  </Button>
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
                  {/* Fiş altı iskonto: KDV dahil tutar ya da yüzde (₺ / % düğmesi). */}
                  <div className="flex items-center gap-1">
                    <Input
                      value={active.discount.value}
                      onChange={(e) => patchTicket({ discount: { ...active.discount, value: e.target.value } })}
                      inputMode="decimal"
                      placeholder="İskonto"
                      className="h-9 w-24 text-right"
                      aria-label="Fiş altı iskonto"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-9 px-0 font-bold"
                      onClick={() =>
                        patchTicket({
                          discount: { ...active.discount, type: active.discount.type === "PERCENT" ? "AMOUNT" : "PERCENT" },
                        })
                      }
                      title={active.discount.type === "PERCENT" ? "Yüzde iskonto — tutara çevir" : "Tutar iskontosu — yüzdeye çevir"}
                    >
                      {active.discount.type === "PERCENT" ? "%" : "₺"}
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
                  {isReturn
                    ? "İade sepeti boş — geri alınan ürünleri barkodla okutun ya da arayın"
                    : "Sepet boş — yukarıdan barkod okutun, ürün arayın ya da hızlı ürün tuşlarını kullanın"}
                </div>
              ) : (
                <>
                  {/* MOBİL (< sm): satır başına kart. Tablo 6 sütunla ~520px
                      genişlik istiyor; telefonda miktara/fiyata ancak yatay
                      kaydırarak ulaşılıyordu. Aynı alanlar, aynı yazıcılar. */}
                  <div className="space-y-2 sm:hidden">
                    {active.cart.map((line) => {
                      const t = lineTotals(line)
                      return (
                        <div key={line.key} className="space-y-2 rounded-lg border p-2">
                          <div className="flex items-start gap-1">
                            <div className="min-w-0 flex-1">
                              <Input
                                value={line.description}
                                onChange={(e) => updateLine(line.key, { description: e.target.value })}
                                className="h-9 w-full"
                              />
                              {stockHint(line)}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              onClick={() => removeLine(line.key)}
                              title="Satırı sil"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <QuantityStepper
                              value={line.quantity}
                              onChange={(v) => updateLine(line.key, { quantity: v })}
                              fullWidth
                              className="flex-1"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 shrink-0 gap-1 px-2 text-xs"
                              title={line.productId ? "Geçmiş fiyatlar" : "Fiyat geçmişi için kayıtlı ürün gerekir"}
                              disabled={!line.productId}
                              onClick={() => openPriceHistory(line)}
                            >
                              <Clock className="h-3.5 w-3.5" />
                              Geçmiş
                            </Button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Fiyat
                              </span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={priceEdit?.key === line.key ? priceEdit.value : numInput(round2(line.unitPrice))}
                                placeholder="0"
                                onChange={(e) => {
                                  setPriceEdit({ key: line.key, value: e.target.value })
                                  updateLine(line.key, { unitPrice: parseFloat(e.target.value) || 0 })
                                }}
                                onBlur={() => setPriceEdit(null)}
                                className="h-9 w-full text-right"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                KDV%
                              </span>
                              <Input
                                type="number"
                                step="1"
                                min="0"
                                inputMode="decimal"
                                value={numInput(line.vatRate)}
                                placeholder="0"
                                onChange={(e) => updateLine(line.key, { vatRate: parseFloat(e.target.value) || 0 })}
                                className="h-9 w-full text-right"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Tutar
                              </span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={totalEdit?.key === line.key ? totalEdit.value : numInput(round2(t.total))}
                                placeholder="0"
                                onChange={(e) => {
                                  setTotalEdit({ key: line.key, value: e.target.value })
                                  updateLineTotal(line.key, parseFloat(e.target.value) || 0)
                                }}
                                onBlur={() => setTotalEdit(null)}
                                className="h-9 w-full text-right font-semibold tabular-nums"
                                title="Tutarı değiştir — birim fiyat otomatik hesaplanır"
                              />
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* sm ve üstü: tablo görünümü */}
                  <div className="hidden overflow-auto sm:block xl:max-h-[46vh]">
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
                              <div className="flex items-center gap-1">
                                <div className="min-w-[140px] flex-1">
                                  <Input
                                    value={line.description}
                                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                                    className="w-full"
                                  />
                                  {stockHint(line)}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 shrink-0 gap-1 px-2 text-xs"
                                  title={line.productId ? "Geçmiş satış/alış fiyatları" : "Fiyat geçmişi için kayıtlı ürün gerekir"}
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
                </>
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
                <div className="grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto sm:max-h-[22vh] sm:grid-cols-3 lg:grid-cols-4">
                  {quickProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        addProductToCart(p)
                        focusScan()
                      }}
                      className="flex flex-col justify-between gap-1 rounded-lg border border-border p-2 text-left transition-colors hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                    >
                      <span className="line-clamp-2 text-xs font-medium">{p.name}</span>
                      <span className="text-[11px] font-semibold text-kobipo-blue dark:text-primary">
                        {p.salePrice != null ? formatMoney(Number(p.salePrice), p.currency) : "—"}
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
        <div className="min-w-0 space-y-3 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
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
                {selectedCustomerBalance != null && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Cari bakiye:{" "}
                    {selectedCustomerBalance > 0.005 ? (
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        {currency(selectedCustomerBalance)} borçlu
                      </span>
                    ) : selectedCustomerBalance < -0.005 ? (
                      <span className="font-semibold text-kobipo-green">
                        {currency(-selectedCustomerBalance)} alacaklı
                      </span>
                    ) : (
                      <span className="font-semibold">borcu yok</span>
                    )}
                  </p>
                )}
                {payment.isCredit && !active.customerId && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    {isReturn
                      ? "Alacak yazmak için müşteri seçin — seçilmezse iade tutarı kimsenin alacağına yazılmaz."
                      : "Veresiye için müşteri seçin — seçilmezse fiş ödenmemiş kalır ama kimseye borç yazılmaz."}
                  </p>
                )}
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

          {/* Ödeme — Kahveci Satış'la ORTAK panel (yemek kartı hariç). */}
          <Card>
            <CardContent className="space-y-3 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ödeme</Label>
              <PaymentPanel
                total={payTotal}
                state={payment}
                onChange={patchPayment}
                accounts={accounts}
                methods={QUICK_SALE_METHODS}
                quickCash={QUICK_CASH}
                shortcuts={PAY_SHORTCUTS}
                refund={isReturn}
              />
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
              {disc.gross > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{ticketDiscountLabel(active.discount.type, discountValue)}</span>
                  <span className="tabular-nums text-red-600 dark:text-red-400">−{currency(disc.gross)}</span>
                </div>
              )}
              <div
                className={cn(
                  "flex items-baseline justify-between rounded-lg px-3 py-2",
                  isReturn ? "bg-red-50 dark:bg-red-950/40" : "bg-kobipo-pale/60 dark:bg-primary/10"
                )}
              >
                <span className="font-semibold">{isReturn ? "İade Toplamı" : "Genel Toplam"}</span>
                <span
                  className={cn(
                    "text-2xl font-extrabold tabular-nums",
                    isReturn ? "text-red-600 dark:text-red-400" : "text-kobipo-blue dark:text-primary"
                  )}
                >
                  {currency(payTotal)}
                </span>
              </div>
              {summary.remaining > 0.005 && (
                <div className="flex justify-between px-1 text-sm">
                  <span className="text-muted-foreground">{isReturn ? "Cariye alacak" : "Açık kalan"}</span>
                  <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {currency(summary.remaining)}
                  </span>
                </div>
              )}
              <Button
                className="mt-1 h-12 w-full text-base"
                variant={isReturn ? "destructive" : "success"}
                // Sarmalı: handleComplete'in ilk argümanı ödeme seçimi — tıklama olayı oraya gitmesin.
                onClick={() => void handleComplete()}
                disabled={isSubmitting || active.cart.length === 0}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    İşleniyor…
                  </>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    {isReturn ? <Undo2 className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                    {isReturn ? "İadeyi Tamamla" : "Satışı Tamamla"}
                    {totals.total > 0 && (
                      <span className="ml-1 rounded-md bg-white/20 px-2 py-0.5 text-sm font-bold tabular-nums">
                        {currency(payTotal)}
                      </span>
                    )}
                  </span>
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Kbd>F2</Kbd> tamamla · <Kbd>F8</Kbd> nakit · <Kbd>F9</Kbd> kart ·{" "}
                <Kbd>F10</Kbd> {isReturn ? "cariye alacak" : "açık hesap"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Eksik tahsilat: açık kalan tutar müşteri yoksa kimseye borç yazılmaz. */}
      <Dialog open={shortPayWarn !== null} onOpenChange={(open) => !open && setShortPayWarn(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{isReturn ? "Ödenmeyen iade tutarı var" : "Tahsil edilmeyen tutar var"}</DialogTitle>
            <DialogDescription>
              {isReturn
                ? `${currency(shortPayWarn ?? 0)} müşteriye ödenmiyor ve müşteri seçilmediği için bu tutar kimsenin alacağına yazılmayacak. Alacak yazmak için önce müşteri seçin.`
                : `${currency(shortPayWarn ?? 0)} açık kalıyor ve müşteri seçilmediği için bu tutar kimseye borç yazılmayacak. Veresiye takibi için önce müşteri seçin.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setShortPayWarn(null)}>
              Geri dön
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                shortPayAcked.current = true
                setShortPayWarn(null)
                void handleComplete()
              }}
            >
              Yine de tamamla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PriceCheckDialog
        open={priceCheckOpen}
        onOpenChange={setPriceCheckOpen}
        products={refProducts}
        warehouses={warehouses}
        warehouseStocks={warehouseStocks}
        onAdd={(p) => addProductToCart(p)}
        onClosed={focusScan}
        recipeProductIds={recipeMap}
      />

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

          <div className="max-h-[50vh] overflow-auto">
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

      {/* Satış tamamlandı: yazdır / paylaş */}
      <Dialog open={lastSale !== null} onOpenChange={(open) => !open && setLastSale(null)}>
        <DialogContent
          className="sm:max-w-sm"
          // Pencere kapanınca odak "Satışı Tamamla" düğmesine değil barkod kutusuna dönsün:
          // kasiyer bir sonraki ürünü hemen okutabilsin.
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusScan()
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-kobipo-green" />
              {lastSale?.receipt.isReturn ? "İade tamamlandı" : "Satış tamamlandı"}
            </DialogTitle>
            <DialogDescription>
              {lastSale?.invoiceNo ? `${lastSale.invoiceNo} oluşturuldu.` : "Fiş oluşturuldu."}{" "}
              {lastSale?.receipt.isReturn
                ? "Ürünler stoğa girdi. İade fişini yazdırabilir veya paylaşabilirsiniz."
                : "Fiş ya da fatura yazdırabilir veya paylaşabilirsiniz."}
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
            <Button variant="outline" onClick={printSale}>
              <FileText className="mr-2 h-4 w-4" />
              Fatura
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

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "brand" | "blue" | "green" | "red" | "amber"
}) {
  const toneClass =
    tone === "green"
      ? "text-kobipo-green"
      : tone === "blue"
        ? "text-kobipo-blue dark:text-primary"
        : tone === "red"
          ? "text-red-600 dark:text-red-400"
          : tone === "amber"
            ? "text-amber-600 dark:text-amber-400"
            : "text-kobipo-navy dark:text-foreground"
  return (
    <div className="rounded-xl border bg-card p-2.5 shadow-sm sm:p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-base font-extrabold tabular-nums sm:text-lg lg:text-xl", toneClass)}>{value}</p>
    </div>
  )
}
