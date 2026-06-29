"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
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
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, Search, Eye, Pencil, Trash2, AlertTriangle, Tags } from "lucide-react"
import Link from "next/link"

interface Product {
  id: string
  code?: string
  name: string
  barcode?: string
  category?: string | null
  unit: string
  vatRate: number
  purchasePrice?: number
  avgPurchasePrice?: number | null
  salePrice?: number
  salePriceVatIncluded?: boolean
  purchasePriceVatIncluded?: boolean
  stockQuantity: number
  minStockLevel?: number | null
  isService: boolean
  isActive: boolean
}

const fmtQty = (n: number) =>
  new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n || 0))

/** Stok uyarı durumu — engelleme yok, yalnızca görsel uyarı. */
function stockState(p: Product): "out" | "low" | "ok" {
  if (p.isService) return "ok"
  const q = Number(p.stockQuantity)
  if (q <= 0) return "out"
  if (p.minStockLevel != null && q <= Number(p.minStockLevel)) return "low"
  return "ok"
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
  purchasePriceVatIncluded: false,
  salePriceVatIncluded: false,
  stockQuantity: "0",
  minStockLevel: "",
  isService: false,
}

/** Net fiyatı, KDV dahil gösterilecekse brüte çevirir (gösterim için). */
function toDisplayPrice(net: number | undefined, included: boolean | undefined, vatRate: number): string {
  if (net == null) return ""
  const gross = included && vatRate > 0 ? net * (1 + vatRate / 100) : net
  // Kuruş yuvarlama; gereksiz uzun ondalıkları kırp.
  return String(Math.round(gross * 100) / 100)
}

export default function StokPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState("")
  const [filterService, setFilterService] = useState<string | null>(null)
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState("ALL")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({ ...emptyProductForm })
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
  }, [companyId, search, filterService])

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
        ...(filterService !== null && { isService: filterService }),
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
      stockQuantity: String(product.stockQuantity),
      minStockLevel: product.minStockLevel != null ? String(product.minStockLevel) : "",
      isService: product.isService,
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

  const lowStockCount = products.filter((p) => stockState(p) !== "ok").length
  let visibleProducts = products
  if (warehouseFilter !== "ALL") {
    visibleProducts = visibleProducts.filter((p) => inSelectedWh.has(p.id))
  }
  if (categoryFilter !== "ALL") {
    visibleProducts = visibleProducts.filter((p) => (p.category || "") === categoryFilter)
  }
  if (onlyLowStock) visibleProducts = visibleProducts.filter((p) => stockState(p) !== "ok")

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
                <div className="space-y-2 md:col-span-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="isService"
                      checked={formData.isService}
                      onChange={(e) =>
                        setFormData({ ...formData, isService: e.target.checked })
                      }
                      disabled={isLoading}
                      className="rounded"
                    />
                    <Label htmlFor="isService">Hizmet</Label>
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

      {lowStockCount > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/20 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong>{lowStockCount}</strong> üründe stok minimum seviyede veya altında.
            </span>
          </div>
          <Button
            variant={onlyLowStock ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyLowStock((v) => !v)}
          >
            {onlyLowStock ? "Tümünü göster" : "Yalnızca düşük stok"}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Ürünler ve Hizmetler</CardTitle>
              <CardDescription>
                Toplam {products.length} kayıt
                {visibleProducts.length !== products.length
                  ? ` · ${visibleProducts.length} gösteriliyor`
                  : ""}
                {categoryOptions.length > 0 ? ` · ${categoryOptions.length} kategori` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:space-x-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-full sm:w-64"
                />
              </div>
              <select
                value={filterService ?? ""}
                onChange={(e) =>
                  setFilterService(e.target.value || null)
                }
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Tümü</option>
                <option value="false">Ürünler</option>
                <option value="true">Hizmetler</option>
              </select>
              {categoryOptions.length > 0 && (
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="ALL">Tüm Kategoriler</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
              {showWhCol && (
                <select
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="ALL">Tüm Depolar</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              )}
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
                  <TableCell colSpan={showWhCol ? 12 : 11} className="text-center">
                    {onlyLowStock ? "Düşük stoklu ürün yok" : warehouseFilter !== "ALL" ? "Bu depoda ürün yok" : "Kayıt bulunamadı"}
                  </TableCell>
                </TableRow>
              ) : (
                visibleProducts.map((product, idx) => (
                  <StyledTableRow
                    key={product.id}
                    index={idx}
                    className="cursor-pointer"
                    onClick={() => router.push(`/stok/${product.id}?company=${companyId}`)}
                  >
                    <TableCell><MonoCell value={product.code} /></TableCell>
                    <TableCell className="font-medium">
                      <EntityCell name={product.name} />
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
                        ? new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(product.avgPurchasePrice)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap font-semibold">
                      {product.salePrice
                        ? new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(product.salePrice)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {product.isService ? (
                        "-"
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Link href={`/stok/${product.id}?company=${companyId}`}>
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

