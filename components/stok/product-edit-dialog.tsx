"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UnitCombobox } from "@/components/ui/unit-combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useModuleEnabled } from "@/lib/swr/use-module"
import {
  flagsForKind,
  productKindOf,
  productKindOptions,
} from "@/lib/stock/product-kind"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"

/**
 * Ürün detay sayfasında (ve gerekirse başka yerlerde) yeniden kullanılabilen,
 * kendi kendine yeten ürün düzenleme dialog'u. Kategori/depo/kur verilerini
 * kendisi çeker ve verilen ürünü PUT ile günceller. Kaydedince `onSaved` ile
 * çağıran taraf veriyi tazeler.
 */

export interface EditableProduct {
  id: string
  code?: string | null
  name: string
  barcode?: string | null
  category?: string | null
  /** Depodaki fiziksel yer (raf/koridor/göz) — serbest metin. */
  shelfCode?: string | null
  unit: string
  vatRate: number | string
  purchasePrice?: number | null
  salePrice?: number | null
  currency?: string | null
  purchasePriceVatIncluded?: boolean | null
  salePriceVatIncluded?: boolean | null
  stockQuantity?: number | string
  minStockLevel?: number | string | null
  isService: boolean
  /** Satış/menü ekranlarında listelenir mi. Bkz. docs/restoran/PLAN.md "Adım 2". */
  isSellable?: boolean
  /** Reçete bileşeni mi. isSellable ile birbirini dışlamaz. */
  isIngredient?: boolean
}

interface ProductEditDialogProps {
  companyId: string
  product: EditableProduct
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

/** Net fiyatı, KDV dahil gösterilecekse brüte çevirir (gösterim için). */
function toDisplayPrice(net: number | undefined | null, included: boolean | undefined | null, vatRate: number): string {
  if (net == null) return ""
  const gross = included && vatRate > 0 ? net * (1 + vatRate / 100) : net
  return String(Math.round(gross * 100) / 100)
}

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

export function ProductEditDialog({
  companyId,
  product,
  open,
  onOpenChange,
  onSaved,
}: ProductEditDialogProps) {
  const { toast } = useToast()
  const isRestaurant = useModuleEnabled("restaurant")
  const kindOptions = useMemo(() => productKindOptions(isRestaurant), [isRestaurant])

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    barcode: "",
    category: "",
    shelfCode: "",
    unit: "ADET",
    vatRate: "20",
    purchasePrice: "",
    salePrice: "",
    currency: "TRY",
    purchasePriceVatIncluded: false,
    salePriceVatIncluded: false,
    minStockLevel: "",
    isService: false,
    isSellable: true,
    isIngredient: false,
  })
  const [isLoading, setIsLoading] = useState(false)
  /** Formdaki üç bayraktan türetilen tek seçim (lib/stock/product-kind.ts). */
  const productKind = productKindOf(formData)

  const [categories, setCategories] = useState<{ id: string; label: string }[]>([])
  const [addingFormCategory, setAddingFormCategory] = useState(false)
  const [formNewCategory, setFormNewCategory] = useState("")
  const [categorySaving, setCategorySaving] = useState(false)

  const [warehouses, setWarehouses] = useState<{ id: string; name: string; isDefault?: boolean }[]>([])
  const [editWarehouseId, setEditWarehouseId] = useState("")
  const [originalWarehouseId, setOriginalWarehouseId] = useState("")

  const [rates, setRates] = useState<{ USD: number; EUR: number } | null>(null)
  const [marginEdit, setMarginEdit] = useState<string | null>(null)

  // Dialog her açıldığında formu güncel ürün verisiyle doldur.
  useEffect(() => {
    if (!open) return
    const vat = Number(product.vatRate) || 0
    setFormData({
      code: product.code || "",
      name: product.name || "",
      barcode: product.barcode || "",
      category: product.category || "",
      shelfCode: product.shelfCode || "",
      unit: product.unit || "ADET",
      vatRate: String(product.vatRate ?? "20"),
      purchasePrice: toDisplayPrice(
        product.purchasePrice != null ? Number(product.purchasePrice) : undefined,
        product.purchasePriceVatIncluded,
        vat,
      ),
      salePrice: toDisplayPrice(
        product.salePrice != null ? Number(product.salePrice) : undefined,
        product.salePriceVatIncluded,
        vat,
      ),
      currency: product.currency || "TRY",
      purchasePriceVatIncluded: Boolean(product.purchasePriceVatIncluded),
      salePriceVatIncluded: Boolean(product.salePriceVatIncluded),
      minStockLevel: product.minStockLevel != null ? String(product.minStockLevel) : "",
      isService: product.isService,
      // Şema varsayılanı true; alan gelmezse ürün satılabilir sayılır.
      isSellable: product.isSellable !== false,
      isIngredient: product.isIngredient === true,
    })
    setMarginEdit(null)
    setAddingFormCategory(false)
    setFormNewCategory("")
  }, [open, product])

  // Bağımlı verileri (kategori, depo, kur, ürünün mevcut deposu) dialog açılınca çek.
  useEffect(() => {
    if (!open || !companyId) return

    fetch(`/api/company/definitions?companyId=${companyId}&type=PRODUCT_CATEGORY`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) =>
        setCategories(Array.isArray(data) ? data.map((d: any) => ({ id: d.id, label: d.label })) : []),
      )
      .catch(() => {})

    fetch(`/api/kur`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) setRates({ USD: Number(d.USD), EUR: Number(d.EUR) })
      })
      .catch(() => {})

    Promise.all([
      fetch(`/api/depolar?companyId=${companyId}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/depolar/stok?companyId=${companyId}&productId=${product.id}`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([whList, stockData]) => {
        const arr = Array.isArray(whList) ? whList : []
        setWarehouses(arr)
        const stocks: any[] = Array.isArray(stockData?.stocks) ? stockData.stocks : []
        const nonZero = stocks.filter((s) => Number(s.quantity) !== 0)
        const pool = nonZero.length > 0 ? nonZero : stocks
        const cur =
          pool.length > 0
            ? pool.reduce((a, b) => (Number(b.quantity) > Number(a.quantity) ? b : a)).warehouseId
            : arr.find((w: any) => w.isDefault)?.id ?? arr[0]?.id ?? ""
        setEditWarehouseId(cur)
        setOriginalWarehouseId(cur)
      })
      .catch(() => {})
  }, [open, companyId, product.id])

  const fxRate =
    formData.currency === "USD" ? rates?.USD ?? null : formData.currency === "EUR" ? rates?.EUR ?? null : null

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

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...categories.map((c) => c.label),
          ...(formData.category ? [formData.category] : []),
        ]),
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "tr")),
    [categories, formData.category],
  )

  const handleAddFormCategory = async () => {
    const label = formNewCategory.trim()
    if (!label || !companyId) return
    setCategorySaving(true)
    try {
      const res = await fetch(`/api/company/definitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, type: "PRODUCT_CATEGORY", label }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kategori eklenemedi")
      setCategories((prev) =>
        prev.some((c) => c.label === label) ? prev : [...prev, { id: data?.id || label, label }],
      )
      setFormData((prev) => ({ ...prev, category: label }))
      setAddingFormCategory(false)
      setFormNewCategory("")
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Kategori eklenemedi",
        variant: "destructive",
      })
    } finally {
      setCategorySaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/stok/products/${product.id}?companyId=${encodeURIComponent(companyId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, companyId }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Güncellenemedi")
      }
      // Depo değiştiyse ürünün stoğunu yeni depoya taşı.
      if (!formData.isService && editWarehouseId && editWarehouseId !== originalWarehouseId) {
        await fetch(`/api/stok/products/${product.id}/warehouse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, warehouseId: editWarehouseId }),
        }).catch(() => {})
      }
      toast({ title: "Başarılı", description: "Ürün güncellendi" })
      onOpenChange(false)
      onSaved?.()
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ürün Düzenle</DialogTitle>
          <DialogDescription>Ürün veya hizmet bilgilerini güncelleyin</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-code">Stok Kodu</Label>
              <Input
                id="edit-code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-barcode">Barkod</Label>
              <Input
                id="edit-barcode"
                value={formData.barcode}
                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Ad *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category">Kategori</Label>
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
                    id="edit-category"
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
              <Label htmlFor="edit-shelf-code">Raf No</Label>
              <Input
                id="edit-shelf-code"
                value={formData.shelfCode}
                onChange={(e) => setFormData({ ...formData, shelfCode: e.target.value })}
                placeholder="ör. A-04"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-unit">Birim</Label>
              <UnitCombobox
                id="edit-unit"
                value={formData.unit}
                onChange={(v) => setFormData({ ...formData, unit: v })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-vatRate">KDV Oranı (%)</Label>
              <Input
                id="edit-vatRate"
                type="number"
                step="0.01"
                value={formData.vatRate}
                onChange={(e) => setFormData({ ...formData, vatRate: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-currency">Para Birimi</Label>
              <Select
                value={formData.currency}
                onValueChange={(v) => setFormData({ ...formData, currency: v })}
                disabled={isLoading}
              >
                <SelectTrigger id="edit-currency">
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
            <div className="space-y-2">
              <Label htmlFor="edit-purchasePrice">Alış Fiyatı</Label>
              <Input
                id="edit-purchasePrice"
                type="number"
                step="0.01"
                value={formData.purchasePrice}
                onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                disabled={isLoading}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={formData.purchasePriceVatIncluded}
                  onChange={(e) => setFormData({ ...formData, purchasePriceVatIncluded: e.target.checked })}
                  disabled={isLoading}
                />
                KDV dahil
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-salePrice">Satış Fiyatı</Label>
              <Input
                id="edit-salePrice"
                type="number"
                step="0.01"
                value={formData.salePrice}
                onChange={(e) => setFormData({ ...formData, salePrice: e.target.value })}
                disabled={isLoading}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={formData.salePriceVatIncluded}
                  onChange={(e) => setFormData({ ...formData, salePriceVatIncluded: e.target.checked })}
                  disabled={isLoading}
                />
                KDV dahil
              </label>
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
              <Label htmlFor="edit-minStockLevel">Minimum Stok</Label>
              <Input
                id="edit-minStockLevel"
                type="number"
                step="0.01"
                value={formData.minStockLevel}
                onChange={(e) => setFormData({ ...formData, minStockLevel: e.target.value })}
                disabled={isLoading || formData.isService}
              />
            </div>
            {!formData.isService && warehouses.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="edit-warehouse">Depo</Label>
                <select
                  id="edit-warehouse"
                  value={editWarehouseId}
                  onChange={(e) => setEditWarehouseId(e.target.value)}
                  disabled={isLoading}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.isDefault ? " (Ana)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Değiştirilirse ürünün tüm stoğu seçilen depoya taşınır.
                </p>
              </div>
            )}
            {/* TEK soru — /stok ürün formuyla birebir aynı seçenekler.
                Bkz. lib/stock/product-kind.ts */}
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              İptal
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
