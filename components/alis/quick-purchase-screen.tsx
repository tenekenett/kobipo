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
  PackagePlus,
  Plus,
  Printer,
  Receipt,
  Search,
  Share2,
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

// Ödeme kutusu ve fiş + ödeme akışı Hızlı Satış / Kahveci ile ORTAK
// (components/satis/payment-panel.tsx + lib/satis/submit-receipt-sale.ts).
// Eskiden bu ekranın kendi kopyası vardı ve Hızlı Satış'a giren düzeltmeleri
// almamıştı (çift alış kilidi, tedarikçisiz açık hesap uyarısı, kart → POS
// hesabı) — 2026-10-06.
const QUICK_PURCHASE_METHODS: PaymentMethod[] = ["CASH", "CREDIT_CARD", "BANK_TRANSFER"]
const QUICK_CASH = [20, 50, 100, 200]

// Tek tuşla ödeme: yöntemi seçer VE alışı tamamlar (F2 seçili yöntemle tamamlar).
type QuickPay = "CASH" | "CREDIT_CARD" | "CREDIT"
const PAY_KEYS: Record<string, QuickPay> = { F8: "CASH", F9: "CREDIT_CARD", F10: "CREDIT" }
const PAY_SHORTCUTS: PaymentShortcuts = { CASH: "F8", CREDIT_CARD: "F9", CREDIT: "F10" }

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

// note: alış anında girilen kısa fiş notu (fişe basılır). Not ve ödeme Ticket'ta
// tutulur ki park edilen alışlar arasında geçiş yapınca kaybolmasın.
// `payment.accountId` boşsa firmanın varsayılan kasası kullanılır (bkz. `payment`).
type Ticket = { cart: CartLine[]; supplierId?: string; note: string; payment: PaymentState }
const emptyTicket = (): Ticket => ({ cart: [], supplierId: undefined, note: "", payment: emptyPaymentState() })

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
  // Ürün kartı USD/EUR fiyat tutabilir, fiş ise TRY kesilir (aşağıdaki
  // `currency: "TRY"`); dönüşüm sepete eklerken yapılır. Kur alınamazsa fiyat 0
  // kalır ve kullanıcı uyarılır — bkz. lib/exchange/use-try-price.ts.
  const { toTRY } = useTryPrice()

  // Referans veriler SWR ile önbelleklenir: ekranlar arası paylaşılır ve her
  // mount'ta yeniden çekilmez (aynı anahtar 30 sn içinde dedupe edilir).
  const { products: refProducts } = useProducts(companyId, { isService: false })
  const { suppliers } = useSuppliers(companyId)
  const { accounts, mutate: mutateAccounts } = useAccounts(companyId)
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
        // Barkod ve para birimi TAŞINMALI: barkod aramanın girdisi (yoksa okutulan
        // kod hiçbir ürünü bulmaz ve ekran "yeni ürün" diyaloğunu açar), para birimi
        // de fiyatın hangi cinsten olduğunu söyler.
        barcode: p.barcode,
        currency: p.currency,
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

  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)
  const [miscAmount, setMiscAmount] = useState("")

  const [isSubmitting, setIsSubmitting] = useState(false)
  /**
   * Çift alış kilidi (Hızlı Satış/Kahveci ile aynı kural). `isSubmitting` state'i
   * tek başına yetmiyor: F2 basılı tutulunca ya da çift tıklamada iki çağrı aynı
   * render'da geçebilir — iki fiş, iki stok girişi, iki ödeme olurdu.
   */
  const submitLock = useRef(false)
  /**
   * Eksik ödeme onayı: tedarikçi seçilmeden açık hesap ya da eksik parçalı ödeme
   * yapılırsa kalan borç KİMSEYE yazılmaz. Sessiz geçilmez, sorulur.
   */
  const [shortPayWarn, setShortPayWarn] = useState<number | null>(null)
  const shortPayAcked = useRef(false)
  /** Barkod kutusu — her eklemeden ve alıştan sonra odak buraya döner. */
  const scanRef = useRef<ProductComboboxHandle>(null)
  const [lastPurchase, setLastPurchase] = useState<
    { id: string; invoiceNo?: string | null; receipt: ReceiptData } | null
  >(null)
  /** Son işlem satırı — pencere kapandıktan sonra da durur (yeniden yazdırma için). */
  const [recent, setRecent] = useState<(RecentDoc & { receipt: ReceiptData }) | null>(null)
  // Tutar sütununda düzenlenen satır (yazarken alanın kullanıcıyla çakışmasını önler).
  const [totalEdit, setTotalEdit] = useState<{ key: string; value: string } | null>(null)
  // Fiyat sütununda düzenlenen satır — birim fiyat 6 ondalık olabildiğinden (Tutar'dan
  // geri hesaplanınca) alan odak dışıyken 2 ondalıkla gösterilir, yazarken ham girişi korur.
  const [priceEdit, setPriceEdit] = useState<{ key: string; value: string } | null>(null)

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

  // FİRMA DEĞİŞİNCE depo seçimi sıfırlanır. Yukarıdaki varsayılan-seçme etkisi
  // yalnız alan BOŞKEN çalışıyor: sıfırlamazsak panelde firma değiştirildiğinde
  // eski firmanın depo id'si state'te kalır ve satış onun deposuna yazılırdı
  // (sunucu da artık reddedip varsayılana düşüyor, bkz. resolveCompanyWarehouseId).
  // Bekleyen alışlar da sıfırlanır: sepet eski firmanın ürünlerini, ödeme eski
  // firmanın kasa/banka hesabını taşır.
  useEffect(() => {
    setWarehouseId("")
    setTickets(Array.from({ length: NUM_TICKETS }, emptyTicket))
    setActiveTicket(0)
    setRecent(null)
  }, [companyId])

  // Ödeme kanalları — kural Hızlı Satış ve Kahveci ile ortak.
  const channelIds = useMemo(() => defaultPaymentAccounts(accounts), [accounts])
  const defaultAccountId = channelIds.cashAccountId ?? accounts[0]?.id ?? ""
  // Aktif alışın ödemesi; hesap seçilmemişse varsayılan kasa.
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
  // Bir pencere açılınca barkod listesi kapanır (liste pencerenin ÜSTÜNDE kalıyordu).
  const anyScreenDialog = lastPurchase !== null || shortPayWarn !== null || priceModalLine !== null
  useEffect(() => {
    if (anyScreenDialog) scanRef.current?.close()
  }, [anyScreenDialog])

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

  /**
   * Ürün ALIŞ fiyatının TL karşılığı — `salePrice` alanı bu ekranda alış fiyatını
   * taşır (bkz. yukarıdaki eşleme). Kural: lib/exchange/use-try-price.ts.
   */
  const priceInTRY = useCallback(
    (product: ComboboxProduct): number =>
      toTRY(product.salePrice != null ? Number(product.salePrice) : 0, product.currency, product.name),
    [toTRY]
  )

  const addProductToCart = useCallback(
    (product: ComboboxProduct, opts?: { quantity?: number }) => {
      // "3*barkod" ile gelen miktar; yoksa 1.
      const qty = opts?.quantity && opts.quantity > 0 ? opts.quantity : 1
      // Alış = stok girişi: depoyu değiştirme, kullanıcının seçtiği (varsayılan Ana) depo kalsın.
      // Fiyat (ve çeviri uyarısı) yalnız satır İLK kez eklenirken hesaplanır.
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
    [active.cart, patchCart, priceInTRY]
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
  const summary = paymentSummary(payment, totals.total)
  // "Ödenen" kutusu: nakitte tedarikçiye verilen, parçalıda girilen toplam, kart/
  // havalede tutarın tamamı, açık hesapta 0.
  const paidDisplay = payment.isCredit
    ? 0
    : payment.splitMode
      ? portionsTotal(payment.portions)
      : payment.method === "CASH"
        ? parseAmount(payment.tendered)
        : round2(totals.total)

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

  const resetPurchase = useCallback(() => {
    setTickets((prev) => prev.map((t, i) => (i === activeTicket ? emptyTicket() : t)))
    // Onay bu alışa aitti — sonrakinde yeniden sorulur.
    shortPayAcked.current = false
  }, [activeTicket])

  /**
   * Alışı tamamlar. `override` tek tuşla ödemeden gelir (F8/F9/F10): state
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
      const pay: PaymentState = override ? { ...payment, ...override } : payment

      // Ödenmeden kalan tutar (açık hesap ya da eksik parçalı ödeme) tedarikçi
      // yoksa kimseye borç yazılmaz — önce sorulur.
      const pending = paymentSummary(pay, t.total)
      if (pending.remaining > 0.005 && !tk.supplierId && !shortPayAcked.current) {
        setShortPayWarn(pending.remaining)
        return
      }

      submitLock.current = true
      setIsSubmitting(true)
      try {
        // Hızlı alış FİŞ keser (resmî fatura değil). Stok girişi + ödeme anında
        // işler; fiş "Fişler" listesinden toplu faturaya dönüştürülebilir. Ödeme
        // tutarı faturanın SUNUCUDA kayıtlı toplamından hesaplanır (ortak akış).
        const result = await submitReceiptSale({
          companyId,
          direction: "purchase",
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
          supplierId: tk.supplierId,
          warehouseId,
          notes: tk.note,
          fallbackTotal: t.total,
        })

        if (!result.ok) {
          if (result.stage === "payment") {
            // Fiş oluştu, stok girdi — geri almak yerine uyar: ödeme Fişler
            // ekranından tamamlanabilir, fişi silmek stoğu da geri alırdı.
            toast({
              title: "Fiş oluştu, ödeme kaydedilemedi",
              description: result.error,
              variant: "destructive",
            })
            return
          }
          throw new Error(result.error)
        }

        // Fiş kesildi ama stok yazılamadıysa sunucu uyarı döner (alış bloklanmaz).
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
        // yeni açıldıysa listeyi tazele ki sonraki alış onu AÇIKÇA seçsin.
        if (accountNote) void mutateAccounts()
        toast({
          title: "Alış kaydedildi",
          description: withAccountNote(
            `${invoice.invoiceNo ?? "Fiş"} oluşturuldu${
              pay.isCredit ? " (açık hesap)" : ` • ${currency(paidSum)} ödendi`
            }`,
            accountNote,
          ),
        })

        // Fiş için alışın anlık görüntüsü — sepet birazdan sıfırlanacağı için burada al.
        // Toplamlar faturanın sunucudaki değerleriyle hizalı olsun (fiş = fatura).
        const paymentLabel = pay.isCredit ? "Açık hesap" : paymentLabelOf(pay.method, pay.provider)
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
          net: invoice?.netAmount != null ? Number(invoice.netAmount) : t.net,
          vat: invoice?.vatAmount != null ? Number(invoice.vatAmount) : t.vat,
          total: invoiceTotal,
          // Parçalı ödemede döküm `parts`ta; buradaki etiket tek yöntemli alışın başlığı.
          paymentLabel,
          tendered: done.tendered,
          change: done.change,
          isCredit: pay.isCredit,
          parts: pay.splitMode && !pay.isCredit ? receiptParts(parts) : undefined,
        }
        setLastPurchase({ id: invoice.id, invoiceNo: invoice.invoiceNo, receipt })
        setRecent({
          id: invoice.id,
          invoiceNo: invoice.invoiceNo,
          total: invoiceTotal,
          paymentLabel: pay.splitMode && !pay.isCredit ? "Parçalı" : paymentLabel,
          change: done.change,
          receipt,
        })
        resetPurchase()
      } catch (error: any) {
        toast({ title: "Hata", description: error?.message || "Alış tamamlanamadı", variant: "destructive" })
      } finally {
        // Ödeme hatasında try içinden dönülse bile burası çalışır — kilit tek yerde açılır.
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
      resetPurchase,
      suppliers,
      selectedCompany,
      receiptCompany,
      mutateAccounts,
    ]
  )

  /**
   * Tek tuşla ödeme: yöntemi ekranda da seçer, sonra alışı tamamlar. Hesap,
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
  // `e.repeat` elenir; açık bir pencere varken çalışmaz (bkz. Hızlı Satış).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const kind = e.key === "F2" ? "F2" : PAY_KEYS[e.key]
      if (!kind) return
      // F10 tarayıcının menüsünü açar; bu ekranda tuş bizimdir.
      e.preventDefault()
      if (e.repeat || lastPurchase !== null || shortPayWarn !== null || anyDialogOpen()) return
      if (active.cart.length === 0) return
      if (kind === "F2") void handleComplete()
      else quickPay(kind)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleComplete, quickPay, lastPurchase, shortPayWarn, active.cart.length])

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
      <RecentDocBar label="Son alış" idleText="Alış bekleniyor" doc={recent} onPrint={printRecent}>
        <FullscreenButton />
      </RecentDocBar>

      {/* Tutar / Ödenen / Para Üstü kutuları */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Tutar" value={currency(totals.total)} tone="brand" />
        <StatTile label="Ödenen" value={currency(paidDisplay)} tone="blue" />
        <StatTile label="Para Üstü" value={currency(summary.change)} tone="green" />
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[1fr_380px]">
        {/* === SOL: park sekmeleri + sepet === */}
        {/* min-w-0: grid item'ın varsayılan min-width'i `auto`dur — içindeki geniş
            bir eleman (sepet tablosu, uzun ürün adı) sütunu ekran dışına taşırır ve
            sayfa yana kayar. Sıfırlanınca taşma kendi kabında kalır. */}
        <div className="min-w-0 space-y-3">
          {/* Barkod / ürün arama — EN ÜSTTE ve odakta (Hızlı Satış'la aynı düzen):
              okuyucu kodu yazıp Enter'a basar, ürün sepete düşer, odak kutuda kalır.
              "3*barkod" miktarı 3 yapar. */}
          <Card className="border-kobipo-blue/40 dark:border-primary/40">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Search className="h-5 w-5 shrink-0 text-kobipo-blue dark:text-primary" />
                <div className="min-w-0 flex-1">
                  <ProductCombobox
                    companyId={companyId}
                    products={products}
                    defaults={{ unit: "ADET", vatRate: 20 }}
                    priceContext="purchase"
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

          {/* Park edilen tedarikçiler */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tickets.map((t, i) => {
              const tt = cartTotals(t.cart).total
              const supp = t.supplierId ? suppliers.find((s) => s.id === t.supplierId)?.name : null
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
                            <Input
                              value={line.description}
                              onChange={(e) => updateLine(line.key, { description: e.target.value })}
                              className="h-9 min-w-0 flex-1"
                            />
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
                                Alış
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

        {/* === SAĞ: tedarikçi + ödeme paneli === */}
        <div className="min-w-0 space-y-3 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-1.5rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
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
                {payment.isCredit && !active.supplierId && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    Açık hesap için tedarikçi seçin — seçilmezse fiş ödenmemiş kalır ama borç kimseye yazılmaz.
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

          {/* Ödeme — Hızlı Satış/Kahveci ile ORTAK panel. */}
          <Card>
            <CardContent className="space-y-3 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ödeme</Label>
              <PaymentPanel
                total={totals.total}
                state={payment}
                onChange={patchPayment}
                accounts={accounts}
                methods={QUICK_PURCHASE_METHODS}
                quickCash={QUICK_CASH}
                shortcuts={PAY_SHORTCUTS}
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
              <div className="flex items-baseline justify-between rounded-lg bg-kobipo-pale/60 px-3 py-2 dark:bg-primary/10">
                <span className="font-semibold">Genel Toplam</span>
                <span className="text-2xl font-extrabold tabular-nums text-kobipo-blue dark:text-primary">
                  {currency(totals.total)}
                </span>
              </div>
              {summary.remaining > 0.005 && (
                <div className="flex justify-between px-1 text-sm">
                  <span className="text-muted-foreground">Açık kalan</span>
                  <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {currency(summary.remaining)}
                  </span>
                </div>
              )}
              <Button
                className="mt-1 h-12 w-full text-base"
                variant="success"
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
                <Kbd>F2</Kbd> tamamla · <Kbd>F8</Kbd> nakit · <Kbd>F9</Kbd> kart · <Kbd>F10</Kbd> açık hesap
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Eksik ödeme: kalan borç tedarikçi yoksa kimseye yazılmaz. */}
      <Dialog open={shortPayWarn !== null} onOpenChange={(open) => !open && setShortPayWarn(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ödenmeyen tutar var</DialogTitle>
            <DialogDescription>
              {currency(shortPayWarn ?? 0)} ödenmeden kalıyor ve tedarikçi seçilmediği için bu borç
              kimseye yazılmayacak. Takip için önce tedarikçi seçin.
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

      {/* Alış tamamlandı: yazdır / paylaş */}
      <Dialog open={lastPurchase !== null} onOpenChange={(open) => !open && setLastPurchase(null)}>
        <DialogContent
          className="sm:max-w-sm"
          // Pencere kapanınca odak barkod kutusuna dönsün: sonraki ürün hemen okutulabilsin.
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusScan()
          }}
        >
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
    <div className="rounded-xl border bg-card p-2.5 shadow-sm sm:p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-base font-extrabold tabular-nums sm:text-lg lg:text-xl", toneClass)}>{value}</p>
    </div>
  )
}
