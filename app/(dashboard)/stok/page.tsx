"use client"

import { withCompanyHref } from "@/lib/company/href"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UnitCombobox } from "@/components/ui/unit-combobox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
  MonoCell,
} from "@/components/ui/styled-table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, Search, Eye, Pencil, Trash2, AlertTriangle, ChefHat, Sticker, Tags, X } from "lucide-react"
import { useRecipes } from "@/lib/swr/use-company-data"
import { useModuleEnabled } from "@/lib/swr/use-module"
import {
  flagsForKind,
  matchesKindFilter,
  productKindOf,
  productKindOptions,
  type ProductKind,
} from "@/lib/stock/product-kind"
import { cn } from "@/lib/utils"
import { ExportButton } from "@/components/export/export-button"
import Link from "next/link"

interface Product {
  id: string
  slug?: string
  code?: string
  name: string
  barcode?: string
  category?: string | null
  unit: string
  vatRate: number
  purchasePrice?: number
  avgPurchasePrice?: number | null
  salePrice?: number
  currency?: string
  salePriceVatIncluded?: boolean
  purchasePriceVatIncluded?: boolean
  stockQuantity: number
  minStockLevel?: number | null
  isService: boolean
  /** Satış/menü ızgaralarında listelenir mi. Bkz. docs/restoran/PLAN.md "Adım 2". */
  isSellable?: boolean
  /** Reçetelerde bileşen olarak kullanılan kalem mi. isSellable ile birbirini dışlamaz. */
  isIngredient?: boolean
  isActive: boolean
}

const fmtQty = (n: number) =>
  new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n || 0))

// Tutarı ürünün kendi para birimiyle biçimler (₺/$/€). Geçersiz/eksik kodda TRY'ye düşer.
function formatMoney(amount: number, currency?: string | null, signed = false): string {
  const cur = (currency || "TRY").toUpperCase()
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency: ["TRY", "USD", "EUR"].includes(cur) ? cur : "TRY",
    currencyDisplay: "narrowSymbol",
  }
  if (signed) opts.signDisplay = "exceptZero"
  return new Intl.NumberFormat("tr-TR", opts).format(amount)
}

/** Stok uyarı durumu — engelleme yok, yalnızca görsel uyarı. */
function stockState(p: Product): "out" | "low" | "ok" {
  if (p.isService) return "ok"
  const q = Number(p.stockQuantity)
  if (q <= 0) return "out"
  if (p.minStockLevel != null && q <= Number(p.minStockLevel)) return "low"
  return "ok"
}

/**
 * Süzgeç rozeti — açılır kutu yerine tek tıkla açılıp kapanan seçim.
 * Yanındaki sayı "bunu seçersem kaç kayıt kalır"ı gösterir, böylece kullanıcı
 * boş listeye tıklamak zorunda kalmaz.
 */
function FilterChip({
  active,
  count,
  onClick,
  tone = "brand",
  title,
  children,
}: {
  active: boolean
  count?: number
  onClick: () => void
  tone?: "brand" | "warn"
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? tone === "warn"
            ? "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-200"
            : "border-kobipo-blue bg-kobipo-blue text-white dark:border-primary dark:bg-primary dark:text-primary-foreground"
          : tone === "warn"
            ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
            : "border-border bg-background text-muted-foreground hover:border-kobipo-blue/50 hover:text-foreground"
      )}
    >
      {children}
      {count != null && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
            active ? "bg-white/25 dark:bg-black/20" : "bg-muted text-muted-foreground"
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

const emptyProductForm = {
  code: "",
  name: "",
  barcode: "",
  category: "",
  unit: "ADET",
  vatRate: "20",
  purchasePrice: "",
  salePrice: "",
  currency: "TRY",
  purchasePriceVatIncluded: false,
  salePriceVatIncluded: false,
  stockQuantity: "0",
  minStockLevel: "",
  isService: false,
  isSellable: true,
  isIngredient: false,
}

/** Net fiyatı, KDV dahil gösterilecekse brüte çevirir (gösterim için). */
function toDisplayPrice(net: number | undefined, included: boolean | undefined, vatRate: number): string {
  if (net == null) return ""
  const gross = included && vatRate > 0 ? net * (1 + vatRate / 100) : net
  // Kuruş yuvarlama; gereksiz uzun ondalıkları kırp.
  return String(Math.round(gross * 100) / 100)
}

export default function StokPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  // Aktif reçeteler — reçetesi olan ürün satışta KENDİSİ düşmediği için
  // stok bakiyesi anlamsızdır; listede rozetle işaretlenip sayı gizlenir.
  // (Reçete yoksa boş döner, restoran modülü kapalı firmalarda hiçbir etkisi olmaz.)
  const { recipeMap } = useRecipes(companyId)
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState("")
  /**
   * Restoran & Kafe açıkken tür isimleri menü diline geçer (Menü ürünü /
   * Hammadde / Her ikisi / Hizmet). Kapalıyken aynı bayraklar
   * "Ürün / Ürün (satışta gizli) / Hizmet" olur.
   */
  const isRestaurant = useModuleEnabled("restaurant")
  const kindOptions = useMemo(() => productKindOptions(isRestaurant), [isRestaurant])
  /**
   * TEK tür filtresi (null = tümü). Eskiden iki ayrı süzgeç vardı —
   * "Tümü/Ürünler/Hizmetler" ve "Hammaddeler/Menüde görünenler/Tümü" — ve
   * "hizmet" ikisinde birden geçiyordu; hangi kombinasyonun ne gösterdiği
   * belirsizdi. İkisi burada birleşti, isimler ürün formuyla AYNI.
   *
   * VARSAYILAN "tümü" — restoran modülü açıkken bir süre "Hammadde" seçili
   * açılıyordu; ekranı ilk açan kullanıcı ürünlerinin yarısını göremiyor,
   * filtre seçili olduğunu da fark etmiyordu. Ekran genel stok ekranıdır,
   * hiçbir modül onu kendi alt kümesine daraltmaz.
   */
  const [kindFilter, setKindFilter] = useState<ProductKind | null>(null)
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState("ALL")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({ ...emptyProductForm })
  /** Formdaki üç bayraktan türetilen tek seçim (lib/stock/product-kind.ts). */
  const productKind = productKindOf(formData)
  // Güncel TCMB kuru — döviz üründe kârın TL karşılığını göstermek için.
  const [rates, setRates] = useState<{ USD: number; EUR: number } | null>(null)
  useEffect(() => {
    fetch("/api/kur")
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) setRates({ USD: Number(d.USD), EUR: Number(d.EUR) })
      })
      .catch(() => {})
  }, [])
  // Seçili para biriminin TRY karşılığı (kâr TL karşılığı için); TRY veya kur yoksa null.
  const fxRate =
    formData.currency === "USD"
      ? rates?.USD ?? null
      : formData.currency === "EUR"
        ? rates?.EUR ?? null
        : null

  // Alış/satış arasındaki kâr marjı (alış üzeri). Fiyatlar KDV dahil girilmiş
  // olabileceğinden ikisini de net (KDV hariç) tabana indiriyoruz.
  const marginInfo = useMemo(() => {
    const vat = Number(formData.vatRate) || 0
    const toNet = (raw: string, included: boolean) => {
      const v = Number(raw)
      if (!isFinite(v) || v <= 0) return null
      return included && vat > 0 ? v / (1 + vat / 100) : v
    }
    const netPurchase = toNet(formData.purchasePrice, formData.purchasePriceVatIncluded)
    const netSale = toNet(formData.salePrice, formData.salePriceVatIncluded)
    const profit = netPurchase != null && netSale != null ? netSale - netPurchase : null
    const markup =
      netPurchase != null && netPurchase > 0 && netSale != null
        ? ((netSale - netPurchase) / netPurchase) * 100
        : null
    return { netPurchase, netSale, profit, markup }
  }, [
    formData.purchasePrice,
    formData.salePrice,
    formData.vatRate,
    formData.purchasePriceVatIncluded,
    formData.salePriceVatIncluded,
  ])
  // Kâr marjı alanı düzenlenirken tutulan ham metin (yazarken çakışmayı önler).
  const [marginEdit, setMarginEdit] = useState<string | null>(null)

  // Kâr marjı (%) girilince satış fiyatını alış fiyatı üzerinden hesaplar:
  // satış(net) = alış(net) × (1 + marj/100). Satış "KDV dahil" ise brüte çevirip yazar.
  const applyMarkup = (raw: string) => {
    const netPurchase = marginInfo.netPurchase
    if (netPurchase == null) return
    const m = parseFloat(raw.replace(",", "."))
    if (!isFinite(m)) return
    const vat = Number(formData.vatRate) || 0
    const netSale = netPurchase * (1 + m / 100)
    const display = formData.salePriceVatIncluded && vat > 0 ? netSale * (1 + vat / 100) : netSale
    setFormData((prev) => ({ ...prev, salePrice: String(Math.round(display * 100) / 100) }))
  }
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; isDefault?: boolean }[]>([])
  const [createWarehouseId, setCreateWarehouseId] = useState("")
  const [editWarehouseId, setEditWarehouseId] = useState("")
  const [originalWarehouseId, setOriginalWarehouseId] = useState("")
  const [warehouseFilter, setWarehouseFilter] = useState("ALL")
  const [warehouseStocks, setWarehouseStocks] = useState<Array<{ warehouseId: string; warehouseName: string; productId: string; quantity: number }>>([])
  // Yönetilen kategori listesi (CompanyDefinition type=PRODUCT_CATEGORY)
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([])
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false)
  const [newCategoryLabel, setNewCategoryLabel] = useState("")
  const [categorySaving, setCategorySaving] = useState(false)
  // Ürün formu içinde anında yeni kategori ekleme
  const [addingFormCategory, setAddingFormCategory] = useState(false)
  const [formNewCategory, setFormNewCategory] = useState("")

  useEffect(() => {
    if (companyId) {
      fetchProducts()
    }
  }, [companyId, search])

  useEffect(() => {
    if (companyId) fetchCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    fetch(`/api/depolar?companyId=${companyId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const arr = Array.isArray(list) ? list : []
        setWarehouses(arr)
        const def = arr.find((w: any) => w.isDefault) ?? arr[0]
        if (def) setCreateWarehouseId((prev) => prev || def.id)
      })
      .catch(() => {})
  }, [companyId])

  const fetchCategories = async () => {
    if (!companyId) return
    try {
      const res = await fetch(
        `/api/company/definitions?companyId=${companyId}&type=PRODUCT_CATEGORY`,
        { cache: "no-store" }
      )
      if (res.ok) {
        const data = await res.json()
        setCategories(
          Array.isArray(data) ? data.map((d: any) => ({ id: d.id, label: d.label })) : []
        )
      }
    } catch {
      /* sessizce geç */
    }
  }

  // Yeni kategori oluşturur; başarılıysa label'ı döndürür (forma seçtirmek için).
  const createCategory = async (label: string): Promise<string | null> => {
    const l = label.trim()
    if (!l || !companyId) return null
    setCategorySaving(true)
    try {
      const res = await fetch(`/api/company/definitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, type: "PRODUCT_CATEGORY", label: l }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kategori eklenemedi")
      await fetchCategories()
      return l
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Kategori eklenemedi",
        variant: "destructive",
      })
      return null
    } finally {
      setCategorySaving(false)
    }
  }

  const deleteCategory = async (id: string, label: string) => {
    const used = products.some((p) => (p.category || "") === label)
    const msg = used
      ? `"${label}" kategorisi bazı ürünlerde kullanılıyor. Listeden kaldırılsın mı? (Ürünlerdeki etiket korunur.)`
      : `"${label}" kategorisini silmek istediğinize emin misiniz?`
    if (!(await confirm({ title: "Kategoriyi sil", description: msg, confirmLabel: "Sil", variant: "destructive" }))) return
    try {
      const res = await fetch(`/api/company/definitions/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Silinemedi")
      await fetchCategories()
      toast({ title: "Kategori silindi", description: label })
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Kategori silinemedi",
        variant: "destructive",
      })
    }
  }

  // Ürün formu içinden yeni kategori ekleyip forma seçtirir.
  const handleAddFormCategory = async () => {
    const created = await createCategory(formNewCategory)
    if (created) {
      setFormData((prev) => ({ ...prev, category: created }))
      setAddingFormCategory(false)
      setFormNewCategory("")
    }
  }

  const fetchProducts = async () => {
    if (!companyId) return

    try {
      const params = new URLSearchParams({
        companyId,
        ...(search && { search }),
      })

      const [response, stockRes] = await Promise.all([
        fetch(`/api/stok/products?${params}`),
        fetch(`/api/depolar/stok?companyId=${companyId}`),
      ])
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
      if (stockRes.ok) {
        const sd = await stockRes.json()
        setWarehouseStocks(sd.stocks || [])
      }
    } catch (error) {
      console.error("Error fetching products:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/stok/products${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          companyId,
          ...(editingId ? {} : { warehouseId: createWarehouseId || undefined }),
        }),
      })

      if (response.ok) {
        // Düzenlemede depo değiştiyse ürünün stoğunu yeni depoya taşı.
        if (editingId && !formData.isService && editWarehouseId && editWarehouseId !== originalWarehouseId) {
          await fetch(`/api/stok/products/${editingId}/warehouse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, warehouseId: editWarehouseId }),
          }).catch(() => {})
        }
        toast({
          title: "Başarılı",
          description: editingId ? "Ürün güncellendi" : "Ürün oluşturuldu",
        })
        setIsDialogOpen(false)
        setEditingId(null)
        setFormData({ ...emptyProductForm })
        fetchProducts()
      } else {
        const errorData = await response.json()
        throw new Error(errorData.error || "Oluşturulamadı")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const startCreate = () => {
    setEditingId(null)
    setFormData({ ...emptyProductForm })
    setIsDialogOpen(true)
  }

  const startEdit = (product: Product) => {
    setEditingId(product.id)
    setFormData({
      code: product.code || "",
      name: product.name,
      barcode: product.barcode || "",
      category: product.category || "",
      unit: product.unit,
      vatRate: String(product.vatRate),
      // DB net saklar; kullanıcı KDV dahil girdiyse formda brüt göster.
      purchasePrice: toDisplayPrice(product.purchasePrice, product.purchasePriceVatIncluded, Number(product.vatRate)),
      salePrice: toDisplayPrice(product.salePrice, product.salePriceVatIncluded, Number(product.vatRate)),
      purchasePriceVatIncluded: Boolean(product.purchasePriceVatIncluded),
      salePriceVatIncluded: Boolean(product.salePriceVatIncluded),
      currency: product.currency || "TRY",
      stockQuantity: String(product.stockQuantity),
      minStockLevel: product.minStockLevel != null ? String(product.minStockLevel) : "",
      isService: product.isService,
      // Şema varsayılanı true; alan gelmezse ürün satılabilir sayılır.
      isSellable: product.isSellable !== false,
      isIngredient: product.isIngredient === true,
    })
    // Ürünün mevcut deposu: en çok stoğun olduğu depo; yoksa varsayılan.
    const rows = warehouseStocks.filter((s) => s.productId === product.id)
    const curWh = rows.length > 0
      ? rows.reduce((a, b) => (Number(b.quantity) > Number(a.quantity) ? b : a)).warehouseId
      : (warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "")
    setEditWarehouseId(curWh)
    setOriginalWarehouseId(curWh)
    setIsDialogOpen(true)
  }

  const deleteProduct = async (id: string) => {
    if (!(await confirm({ title: "Ürünü sil", description: "Ürünü silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const response = await fetch(`/api/stok/products/${id}`, { method: "DELETE" })
    if (response.ok) {
      toast({ title: "Başarılı", description: "Ürün silindi" })
      fetchProducts()
    } else {
      toast({ title: "Hata", description: "Ürün silinemedi", variant: "destructive" })
    }
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  // Ürün başına depo dağılımı (0 dahil tüm kayıtlar — ürün hangi depoya kayıtlı).
  const stockByProduct = new Map<string, { warehouseId: string; warehouseName: string; quantity: number }[]>()
  for (const s of warehouseStocks) {
    const arr = stockByProduct.get(s.productId) || []
    arr.push({ warehouseId: s.warehouseId, warehouseName: s.warehouseName, quantity: Number(s.quantity) })
    stockByProduct.set(s.productId, arr)
  }
  // Seçili depoda kayıtlı ürünler + o depodaki miktar.
  const inSelectedWh = new Set<string>()
  const whQtyByProduct = new Map<string, number>()
  if (warehouseFilter !== "ALL") {
    for (const s of warehouseStocks) {
      if (s.warehouseId === warehouseFilter) {
        inSelectedWh.add(s.productId)
        whQtyByProduct.set(s.productId, Number(s.quantity))
      }
    }
  }

  // Filtre/seçim için kategori listesi: yönetilen kategoriler + ürünlerde geçen
  // (yönetilen listede olmayan eski) etiketler birleştirilir.
  const categoryOptions = Array.from(
    new Set([
      ...categories.map((c) => c.label),
      ...products.map((p) => (p.category || "").trim()).filter(Boolean),
    ])
  ).sort((a, b) => a.localeCompare(b, "tr"))

  // Reçeteli ürünün bakiyesi hiç değişmediği için "tükendi" sayılamaz — uyarıdan
  // ve düşük stok filtresinden dışarıda tutulur (tabloda da "—" gösteriliyor).
  const isLowStock = (p: Product) => !recipeMap.has(p.id) && stockState(p) !== "ok"

  const lowStockCount = products.filter(isLowStock).length

  // Tür DIŞINDAKİ süzgeçler önce uygulanır; tür rozetlerinin yanındaki sayılar
  // bu küme üzerinden hesaplanır ("bu türe basarsam kaç kayıt kalır").
  let baseProducts = products
  if (warehouseFilter !== "ALL") {
    baseProducts = baseProducts.filter((p) => inSelectedWh.has(p.id))
  }
  if (categoryFilter !== "ALL") {
    baseProducts = baseProducts.filter((p) => (p.category || "") === categoryFilter)
  }
  if (onlyLowStock) baseProducts = baseProducts.filter(isLowStock)

  const kindCounts = new Map<ProductKind, number>(
    kindOptions.map((o) => [o.value, baseProducts.filter((p) => matchesKindFilter(p, o.value)).length])
  )

  const visibleProducts = kindFilter
    ? baseProducts.filter((p) => matchesKindFilter(p, kindFilter))
    : baseProducts

  const activeFilterCount =
    (search ? 1 : 0) +
    (kindFilter ? 1 : 0) +
    (categoryFilter !== "ALL" ? 1 : 0) +
    (warehouseFilter !== "ALL" ? 1 : 0) +
    (onlyLowStock ? 1 : 0)

  const clearFilters = () => {
    setSearch("")
    setKindFilter(null)
    setCategoryFilter("ALL")
    setWarehouseFilter("ALL")
    setOnlyLowStock(false)
  }

  // Depo sütunu/filtresi yalnızca birden çok depo varsa anlamlı.
  const showWhCol = warehouses.length > 1

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stok Yönetimi</h1>
          <p className="text-muted-foreground">
            Ürün ve hizmet kartları
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {/* Ekrandaki filtrelerin aynısı sunucuya gider — indirilen dosya
            tablodaki satırların birebir aynısını içerir. */}
        <ExportButton
          dataset="products"
          companyId={companyId ?? ""}
          size="default"
          params={{
            search,
            kind: kindFilter,
            category: categoryFilter === "ALL" ? null : categoryFilter,
            warehouseId: warehouseFilter === "ALL" ? null : warehouseFilter,
            lowStock: onlyLowStock ? "1" : null,
          }}
        />
        <Button variant="outline" asChild>
          <Link href={withCompanyHref("/stok/etiket", companyId)}>
            <Sticker className="mr-2 h-4 w-4" />
            Etiket Tasarımı
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setIsCategoryDialogOpen(true)}>
          <Tags className="mr-2 h-4 w-4" />
          Kategoriler
        </Button>
        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open)
            if (!open) {
              setEditingId(null)
              setFormData({ ...emptyProductForm })
            }
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={startCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Ürün/Hizmet
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Ürün Düzenle" : "Yeni Ürün/Hizmet"}</DialogTitle>
              <DialogDescription>
                Ürün veya hizmet bilgilerini girin
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="code">Stok Kodu</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="barcode">Barkod</Label>
                  <Input
                    id="barcode"
                    value={formData.barcode}
                    onChange={(e) =>
                      setFormData({ ...formData, barcode: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Kategori</Label>
                  {addingFormCategory ? (
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        value={formNewCategory}
                        onChange={(e) => setFormNewCategory(e.target.value)}
                        placeholder="Yeni kategori adı"
                        disabled={isLoading || categorySaving}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            void handleAddFormCategory()
                          }
                        }}
                      />
                      <Button
                        type="button"
                        onClick={() => void handleAddFormCategory()}
                        disabled={categorySaving || !formNewCategory.trim()}
                        className="shrink-0"
                      >
                        Ekle
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setAddingFormCategory(false)
                          setFormNewCategory("")
                        }}
                        disabled={categorySaving}
                        className="shrink-0"
                      >
                        İptal
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <select
                        id="category"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        disabled={isLoading}
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">— Kategori yok —</option>
                        {categoryOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setFormNewCategory("")
                          setAddingFormCategory(true)
                        }}
                        disabled={isLoading}
                        className="shrink-0"
                        title="Yeni kategori ekle"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Ad *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Birim</Label>
                  <UnitCombobox
                    id="unit"
                    value={formData.unit}
                    onChange={(v) => setFormData({ ...formData, unit: v })}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vatRate">KDV Oranı (%)</Label>
                  <Input
                    id="vatRate"
                    type="number"
                    step="0.01"
                    value={formData.vatRate}
                    onChange={(e) =>
                      setFormData({ ...formData, vatRate: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="purchasePrice">Alış Fiyatı</Label>
                  <Input
                    id="purchasePrice"
                    type="number"
                    step="0.01"
                    value={formData.purchasePrice}
                    onChange={(e) =>
                      setFormData({ ...formData, purchasePrice: e.target.value })
                    }
                    disabled={isLoading}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={formData.purchasePriceVatIncluded}
                      onChange={(e) =>
                        setFormData({ ...formData, purchasePriceVatIncluded: e.target.checked })
                      }
                      disabled={isLoading}
                    />
                    KDV dahil
                  </label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="salePrice">Satış Fiyatı</Label>
                  <Input
                    id="salePrice"
                    type="number"
                    step="0.01"
                    value={formData.salePrice}
                    onChange={(e) =>
                      setFormData({ ...formData, salePrice: e.target.value })
                    }
                    disabled={isLoading}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={formData.salePriceVatIncluded}
                      onChange={(e) =>
                        setFormData({ ...formData, salePriceVatIncluded: e.target.checked })
                      }
                      disabled={isLoading}
                    />
                    KDV dahil
                  </label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Para Birimi</Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(v) => setFormData({ ...formData, currency: v })}
                    disabled={isLoading}
                  >
                    <SelectTrigger id="currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TRY">₺ TRY</SelectItem>
                      <SelectItem value="USD">$ USD</SelectItem>
                      <SelectItem value="EUR">€ EUR</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    TRY dışıysa satış/teklifte güncel TCMB kuruyla TL'ye çevrilir
                  </p>
                </div>
                {marginInfo.netPurchase != null && (
                  <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Kâr marjı (alış üzeri)</span>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="0.1"
                          inputMode="decimal"
                          value={
                            marginEdit ??
                            (marginInfo.markup != null ? String(Math.round(marginInfo.markup * 10) / 10) : "")
                          }
                          placeholder="0"
                          onChange={(e) => {
                            setMarginEdit(e.target.value)
                            applyMarkup(e.target.value)
                          }}
                          onBlur={() => setMarginEdit(null)}
                          disabled={isLoading}
                          className="h-8 w-20 text-right"
                          title="Marjı değiştir — satış fiyatı otomatik hesaplanır"
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    </div>
                    {marginInfo.profit != null && (
                      <div className="flex flex-col items-end leading-tight">
                        <span
                          className={`font-medium ${
                            marginInfo.profit >= 0
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {formatMoney(marginInfo.profit, formData.currency, true)} kâr
                        </span>
                        {fxRate && (
                          <span className="text-[11px] text-muted-foreground">
                            ≈ {formatMoney(marginInfo.profit * fxRate, "TRY", true)} TL karşılığı
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="stockQuantity">Stok Miktarı</Label>
                  <Input
                    id="stockQuantity"
                    type="number"
                    step="0.01"
                    value={formData.stockQuantity}
                    onChange={(e) =>
                      setFormData({ ...formData, stockQuantity: e.target.value })
                    }
                    disabled={isLoading || formData.isService}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minStockLevel">Minimum Stok</Label>
                  <Input
                    id="minStockLevel"
                    type="number"
                    step="0.01"
                    value={(formData as any).minStockLevel}
                    onChange={(e) =>
                      setFormData({ ...(formData as any), minStockLevel: e.target.value })
                    }
                    disabled={isLoading || formData.isService}
                  />
                </div>
                {!formData.isService && warehouses.length > 0 && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="warehouse">{editingId ? "Depo" : "Başlangıç stoğu deposu"}</Label>
                    <select
                      id="warehouse"
                      value={editingId ? editWarehouseId : createWarehouseId}
                      onChange={(e) => (editingId ? setEditWarehouseId(e.target.value) : setCreateWarehouseId(e.target.value))}
                      disabled={isLoading}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}{w.isDefault ? " (Ana)" : ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {editingId
                        ? "Değiştirilirse ürünün tüm stoğu seçilen depoya taşınır."
                        : "Girilen stok miktarı bu depoya eklenir."}
                    </p>
                  </div>
                )}
                {/* TEK SORU. Eskiden üç ayrı onay kutusuydu (Hizmet / Menüde
                    göster / Hammadde) → 8 kombinasyon, 4'ü anlamsız: hizmette
                    "menüde göster" hiçbir şey yapmıyordu, üçü birden kapalı olan
                    ürün hiçbir listede görünmüyordu. Bkz. lib/stock/product-kind.ts */}
                <div className="space-y-2 md:col-span-2">
                  <Label>Bu ürün nedir?</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {kindOptions.map((opt) => {
                      const isActive = productKind === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isLoading}
                          onClick={() => setFormData({ ...formData, ...flagsForKind(opt.value) })}
                          className={cn(
                            "rounded-lg border-2 px-3 py-2 text-left transition-colors disabled:opacity-60",
                            isActive
                              ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                              : "border-border hover:border-kobipo-blue/50"
                          )}
                        >
                          <span className="block text-sm font-semibold">{opt.label}</span>
                          <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false)
                    setEditingId(null)
                  }}
                  disabled={isLoading}
                >
                  İptal
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Kategori Yönetimi */}
        <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Kategoriler</DialogTitle>
              <DialogDescription>
                Ürün kategorilerini tanımlayın. Ürün eklerken bu listeden seçilir.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input
                value={newCategoryLabel}
                onChange={(e) => setNewCategoryLabel(e.target.value)}
                placeholder="Yeni kategori adı"
                disabled={categorySaving}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void (async () => {
                      const created = await createCategory(newCategoryLabel)
                      if (created) setNewCategoryLabel("")
                    })()
                  }
                }}
              />
              <Button
                type="button"
                onClick={async () => {
                  const created = await createCategory(newCategoryLabel)
                  if (created) setNewCategoryLabel("")
                }}
                disabled={categorySaving || !newCategoryLabel.trim()}
                className="shrink-0"
              >
                <Plus className="mr-1 h-4 w-4" />
                Ekle
              </Button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {categories.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Henüz kategori yok
                </p>
              ) : (
                categories.map((c) => {
                  const count = products.filter((p) => (p.category || "") === c.label).length
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {c.label}
                        {count > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground">({count})</span>
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteCategory(c.id, c.label)}
                        title="Kategoriyi sil"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>Ürünler ve Hizmetler</CardTitle>
            <CardDescription>
              {activeFilterCount > 0
                ? `${products.length} kayıttan ${visibleProducts.length} tanesi gösteriliyor`
                : `Toplam ${products.length} kayıt`}
            </CardDescription>
          </div>

          {/* Süzgeç çubuğu: üstte arama + açılır kutular, altta tür rozetleri.
              Hepsi tek bir yerde toplandı — düşük stok uyarısı da dahil. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Ad, kod veya barkod ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-8 pr-8"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    title="Aramayı temizle"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {categoryOptions.length > 0 && (
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-9 w-auto min-w-[150px] gap-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Tüm kategoriler</SelectItem>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {showWhCol && (
                <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                  <SelectTrigger className="h-9 w-auto min-w-[140px] gap-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Tüm depolar</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Düşük stok: eskiden tablonun üstünde ayrı bir uyarı kutusuydu.
                  Sayı rozetin içinde durduğu için uyarı da burada görünür. */}
              {lowStockCount > 0 && (
                <FilterChip
                  active={onlyLowStock}
                  count={lowStockCount}
                  tone="warn"
                  onClick={() => setOnlyLowStock((v) => !v)}
                  title="Stoğu minimum seviyede veya altında olan ürünler"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Düşük stok
                </FilterChip>
              )}

              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-muted-foreground">
                  <X className="mr-1 h-4 w-4" />
                  Temizle
                </Button>
              )}
            </div>

            {/* TEK tür filtresi — seçenek isimleri ürün formundakilerle aynı,
                böylece "kaydederken ne dediysem burada onu arıyorum". */}
            <div className="flex flex-wrap gap-1.5">
              <FilterChip active={kindFilter === null} count={baseProducts.length} onClick={() => setKindFilter(null)}>
                Tümü
              </FilterChip>
              {kindOptions.map((o) => (
                <FilterChip
                  key={o.value}
                  active={kindFilter === o.value}
                  count={kindCounts.get(o.value) ?? 0}
                  title={o.hint}
                  onClick={() => setKindFilter(kindFilter === o.value ? null : o.value)}
                >
                  {o.label}
                </FilterChip>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                <StyledTableHead>Kod</StyledTableHead>
                <StyledTableHead>Ad</StyledTableHead>
                <StyledTableHead>Kategori</StyledTableHead>
                <StyledTableHead>Barkod</StyledTableHead>
                <StyledTableHead>Birim</StyledTableHead>
                <StyledTableHead>KDV %</StyledTableHead>
                <StyledTableHead className="text-right">Ort. Alış Fiyatı</StyledTableHead>
                <StyledTableHead className="text-right">Satış Fiyatı</StyledTableHead>
                <StyledTableHead className="text-right">Stok</StyledTableHead>
                {showWhCol && <StyledTableHead>Depo</StyledTableHead>}
                <StyledTableHead>Tip</StyledTableHead>
                <StyledTableHead>İşlem</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {visibleProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showWhCol ? 12 : 11} className="py-10 text-center">
                    {activeFilterCount > 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-sm text-muted-foreground">Süzgeçlere uyan kayıt yok.</p>
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          <X className="mr-1 h-4 w-4" />
                          Süzgeçleri temizle
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Henüz ürün veya hizmet eklenmemiş.</p>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                visibleProducts.map((product, idx) => (
                  <StyledTableRow
                    key={product.id}
                    index={idx}
                    className="cursor-pointer"
                    // Satırın tamamı bağlantı yüzeyi: sağ tık → "yeni sekmede aç".
                    href={`/stok/${product.slug || product.id}?company=${companyId}`}
                    hrefLabel={`${product.name} detayı`}
                  >
                    <TableCell><MonoCell value={product.code} /></TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <EntityCell name={product.name} />
                        {recipeMap.has(product.id) && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-kobipo-pale px-2 py-0.5 text-[11px] font-semibold text-kobipo-blue"
                            title="Bu ürünün reçetesi var: satışta kendisi değil, bileşenleri stoktan düşer."
                          >
                            <ChefHat className="h-3 w-3" />
                            Reçeteli
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.category ? (
                        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs">
                          {product.category}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell><MonoCell value={product.barcode} /></TableCell>
                    <TableCell>{product.unit}</TableCell>
                    <TableCell>{product.vatRate}%</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {product.avgPurchasePrice
                        ? formatMoney(product.avgPurchasePrice, product.currency)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap font-semibold">
                      {product.salePrice
                        ? formatMoney(product.salePrice, product.currency)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {product.isService ? (
                        "-"
                      ) : recipeMap.has(product.id) ? (
                        // Reçeteli ürünün bakiyesi hiç değişmez; sayıyı (ve "Tükendi"
                        // uyarısını) göstermek yanıltıcı olurdu.
                        <span
                          className="text-muted-foreground"
                          title="Reçeteli ürün — stok bileşenlerinden düşer, kendi bakiyesi tutulmaz"
                        >
                          —
                        </span>
                      ) : warehouseFilter !== "ALL" ? (
                        <span className="font-medium">
                          {new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(whQtyByProduct.get(product.id) ?? 0)}
                        </span>
                      ) : (
                        (() => {
                          const st = stockState(product)
                          return (
                            <div className="flex flex-col items-end">
                              <span className={st === "out" ? "font-semibold text-red-600" : st === "low" ? "font-semibold text-amber-600" : ""}>
                                {new Intl.NumberFormat("tr-TR", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }).format(Number(product.stockQuantity))}
                              </span>
                              {st !== "ok" && (
                                <span className={`flex items-center gap-0.5 text-[11px] ${st === "out" ? "text-red-600" : "text-amber-600"}`}>
                                  <AlertTriangle className="h-3 w-3" />
                                  {st === "out" ? "Tükendi" : `Min ${product.minStockLevel}`}
                                </span>
                              )}
                            </div>
                          )
                        })()
                      )}
                    </TableCell>
                    {showWhCol && (
                      <TableCell>
                        {product.isService ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (() => {
                          const rows = stockByProduct.get(product.id) || []
                          const nonZero = rows.filter((r) => r.quantity !== 0)
                          const display = nonZero.length > 0 ? nonZero : rows
                          if (display.length === 0) return <span className="text-xs text-muted-foreground">—</span>
                          return (
                            <div className="flex flex-wrap gap-1">
                              {display.map((d) => (
                                <span key={d.warehouseId} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                  {d.warehouseName}{d.quantity !== 0 ? `: ${fmtQty(d.quantity)}` : ""}
                                </span>
                              ))}
                            </div>
                          )
                        })()}
                      </TableCell>
                    )}
                    <TableCell>
                      {product.isService ? (
                        <span className="text-blue-600">Hizmet</span>
                      ) : (
                        <span className="text-green-600">Ürün</span>
                      )}
                    </TableCell>
                    {/* Aksiyon hücresi bağlantı kaplamasının dışında kalmalı. */}
                    <TableCell data-row-link-skip onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Link href={`/stok/${product.slug || product.id}?company=${companyId}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4 mr-1" />
                            Detay
                          </Button>
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => startEdit(product)}>
                          <Pencil className="h-4 w-4 mr-1" />
                          Düzenle
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteProduct(product.id)}>
                          <Trash2 className="h-4 w-4 mr-1 text-red-600" />
                          Sil
                        </Button>
                      </div>
                    </TableCell>
                  </StyledTableRow>
                ))
              )}
            </TableBody>
          </Table>
          </StyledTableContainer>
        </CardContent>
      </Card>
    </div>
  )
}

