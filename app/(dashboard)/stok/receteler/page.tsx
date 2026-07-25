"use client"

// Reçete ekranı — bkz. docs/restoran/PLAN.md "Adım 3/6", ILERLEME.md "Adım 6".
//
// NOT: Bu sayfa Stok grubunda yaşar ama Restoran & Kafe modülüne bağlıdır
// (nav-config.tsx → NavItemDef.module + PATH_MODULE_OVERRIDES).
//
// Maliyet/marj özeti sunucunun stok düşümüyle AYNI saf fonksiyonu (expandRecipeLines)
// kullanır. Böylece ekranda gösterilen maliyet ile satışta fiilen düşen miktarlar
// hiçbir zaman çelişmez — kendi hesap mantığını burada tekrar yazmak, ikisinin
// zamanla ayrışmasına açık kapı bırakırdı.

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  ChefHat,
  Plus,
  Pencil,
  Trash2,
  Search,
  AlertTriangle,
  X,
  Layers,
  PackageSearch,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { SearchSelect } from "@/components/ui/search-select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { convertUnit, convertibleUnits, normalizeUnitCode } from "@/lib/data/units"
import {
  expandRecipeLines,
  findRecipePath,
  type RecipeMap,
} from "@/lib/stock/recipe-expand"

type Product = {
  id: string
  code?: string | null
  name: string
  category?: string | null
  unit: string
  purchasePrice?: number | null
  avgPurchasePrice?: number | null
  salePrice?: number | null
  stockQuantity: number
  isService: boolean
  isActive: boolean
  isSellable: boolean
}

type RecipeItem = {
  id: string
  componentProductId: string
  quantity: number
  unit: string
  wastageRate: number | null
  order: number
}

type Recipe = {
  id: string
  productId: string
  yieldQuantity: number
  isActive: boolean
  note: string | null
  items: RecipeItem[]
}

/** Dialog içindeki düzenlenebilir kalem — miktar/fire ham metin olarak tutulur. */
type DraftItem = {
  key: string
  componentProductId: string
  quantity: string
  unit: string
  wastageRate: string
}

type Draft = {
  productId: string
  yieldQuantity: string
  isActive: boolean
  note: string
  items: DraftItem[]
}

const money = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
  }).format(Number.isFinite(n) ? n : 0)

/** Stok miktarları Decimal(14,4) — gramaj görünür kalsın diye 4 ondalığa kadar. */
const qty = (n: number) =>
  new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(
    Number(n) || 0
  )

/** "12,5" ve "12.5" ikisini de kabul eder; geçersizse NaN. */
function num(raw: string): number {
  return parseFloat(String(raw ?? "").replace(",", "."))
}

/**
 * /api/stok/products Prisma kaydını olduğu gibi döndürüyor; Decimal alanlar
 * JSON'a STRING olarak serileşiyor ("85"). Burada bir kez sayıya çevrilir —
 * aksi halde aritmetik sessizce çalışır (JS zorlaması) ama Intl biçimleyici
 * string'i geçersiz sayıp 0 basar. Tek yerde normalize etmek, her kullanım
 * noktasına Number() serpiştirmekten güvenli.
 */
function normalizeProduct(raw: any): Product {
  const toNum = (v: unknown): number | null => {
    if (v == null || v === "") return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    ...raw,
    purchasePrice: toNum(raw.purchasePrice),
    avgPurchasePrice: toNum(raw.avgPurchasePrice),
    salePrice: toNum(raw.salePrice),
    stockQuantity: toNum(raw.stockQuantity) ?? 0,
  }
}

let keySeq = 0
const nextKey = () => `i${++keySeq}`

function emptyDraft(productId = ""): Draft {
  return {
    productId,
    yieldQuantity: "1",
    isActive: true,
    note: "",
    items: [{ key: nextKey(), componentProductId: "", quantity: "", unit: "", wastageRate: "" }],
  }
}

export default function ReceptelerPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [products, setProducts] = useState<Product[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<"menu" | "raw">("menu")
  const [search, setSearch] = useState("")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  /** Düzenlenen mevcut reçetenin id'si; yeni reçetede null. */
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    if (companyId) void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function loadAll() {
    if (!companyId) return
    setLoading(true)
    try {
      const [productsRes, recipesRes] = await Promise.all([
        fetch(`/api/stok/products?companyId=${companyId}`),
        fetch(`/api/restoran/recipes?companyId=${companyId}`),
      ])
      if (productsRes.ok) setProducts((await productsRes.json()).map(normalizeProduct))
      if (recipesRes.ok) setRecipes(await recipesRes.json())
    } catch {
      toast({ title: "Veriler yüklenemedi", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const recipeByProduct = useMemo(() => new Map(recipes.map((r) => [r.productId, r])), [recipes])

  /**
   * Hammaddenin birim maliyeti: ağırlıklı ortalama alış, yoksa elle girilen alış.
   * Sunucudaki resolveComponentCosts ile aynı önceliği izler (fiili alış > elle giriş).
   */
  function unitCostOf(productId: string): number | null {
    const p = productById.get(productId)
    if (!p) return null
    const avg = p.avgPurchasePrice
    if (avg != null && Number.isFinite(Number(avg))) return Number(avg)
    if (p.purchasePrice != null && Number.isFinite(Number(p.purchasePrice))) {
      return Number(p.purchasePrice)
    }
    return null
  }

  const unitOf = (productId: string) => productById.get(productId)?.unit ?? null

  /**
   * Kayıtlı reçeteler → genişletme haritası. Sunucudaki loadRecipeContext ile
   * aynı şekilde YALNIZCA aktif reçeteler alınır; pasif reçete satışta da
   * açılmadığı için maliyeti de açılmamış gibi hesaplanmalı.
   */
  const recipeMap = useMemo<RecipeMap>(() => {
    const map: RecipeMap = new Map()
    for (const r of recipes) {
      if (!r.isActive) continue
      map.set(r.productId, {
        yieldQuantity: r.yieldQuantity || 1,
        isActive: r.isActive,
        items: r.items.map((i) => ({
          componentProductId: i.componentProductId,
          quantity: i.quantity,
          unit: i.unit,
          wastageRate: i.wastageRate,
        })),
      })
    }
    return map
  }, [recipes])

  /**
   * Bir mamülün 1 birimlik maliyeti. Çok seviyeli reçetede ara katlar
   * (Espresso) kendiliğinden açılır — expandRecipeLines hammaddeye kadar iner.
   */
  const nameOf = (productId: string) => productById.get(productId)?.name ?? productId

  /**
   * expandRecipeLines hatalarını okunur Türkçeye çevirir. `detail` alanı ham
   * productId zinciri taşıyor (saf fonksiyon ürün adlarını bilmez) — kullanıcıya
   * cuid göstermemek için burada adlara çevrilir.
   */
  function describeError(e: { productId: string; reason: string; detail?: string }): string {
    switch (e.reason) {
      case "CYCLE":
        return `Reçete döngüsü: ${(e.detail ?? e.productId).split(" → ").map(nameOf).join(" → ")}`
      case "DEPTH":
        return `Reçete ${e.detail} kattan derin — "${nameOf(e.productId)}" açılamadı`
      case "UNIT_MISMATCH":
        return `"${nameOf(e.productId)}" için ${e.detail} dönüşümü yapılamıyor`
      default:
        return `"${nameOf(e.productId)}": ${e.reason}`
    }
  }

  function costOf(productId: string, map: RecipeMap): CostResult {
    const { components, errors } = expandRecipeLines({
      lines: [{ productId, quantity: 1 }],
      recipes: map,
      unitOf,
    })
    let total = 0
    const priceless: string[] = []
    for (const c of components) {
      const unitCost = unitCostOf(c.productId)
      if (unitCost == null) {
        priceless.push(nameOf(c.productId))
        continue
      }
      total += c.quantity * unitCost
    }
    return {
      total,
      priceless,
      errors: errors.map(describeError),
      hasRecipe: map.has(productId),
    }
  }

  /**
   * Bir bileşenin 1 stok birimlik maliyeti — hammaddede alış fiyatı, yarı
   * mamülde kendi reçetesinin açılmış maliyeti. Satır maliyetini gösterirken
   * ikisini ayırmak gerekiyor: Espresso'nun alış fiyatı yoktur, maliyeti
   * bileşenlerinden gelir.
   */
  function resolvedUnitCost(productId: string, map: RecipeMap): number | null {
    if (map.has(productId)) {
      const c = costOf(productId, map)
      return c.priceless.length > 0 && c.total === 0 ? null : c.total
    }
    return unitCostOf(productId)
  }

  // ---- Liste ----

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    return products
      .filter((p) => p.isActive && !p.isService)
      .filter((p) => (tab === "menu" ? p.isSellable : !p.isSellable))
      .filter((p) => !q || p.name.toLocaleLowerCase("tr-TR").includes(q) || (p.code ?? "").toLocaleLowerCase("tr-TR").includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"))
  }, [products, tab, search])

  const menuCount = products.filter((p) => p.isActive && !p.isService && p.isSellable).length
  const rawCount = products.filter((p) => p.isActive && !p.isService && !p.isSellable).length

  /** Hangi mamüllerde bileşen olarak geçiyor — hammadde sekmesinde gösterilir. */
  const usedInByComponent = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of recipes) {
      const parentName = productById.get(r.productId)?.name
      if (!parentName) continue
      for (const item of r.items) {
        const list = map.get(item.componentProductId) ?? []
        list.push(parentName)
        map.set(item.componentProductId, list)
      }
    }
    return map
  }, [recipes, productById])

  // ---- Dialog ----

  function openForProduct(product: Product) {
    const existing = recipeByProduct.get(product.id)
    setServerError(null)
    setEditingRecipeId(existing?.id ?? null)
    if (existing) {
      setDraft({
        productId: existing.productId,
        yieldQuantity: String(existing.yieldQuantity),
        isActive: existing.isActive,
        note: existing.note ?? "",
        items: existing.items.map((i) => ({
          key: nextKey(),
          componentProductId: i.componentProductId,
          quantity: String(i.quantity),
          unit: i.unit,
          wastageRate: i.wastageRate != null ? String(i.wastageRate) : "",
        })),
      })
    } else {
      setDraft(emptyDraft(product.id))
    }
    setDialogOpen(true)
  }

  function openNew() {
    setServerError(null)
    setEditingRecipeId(null)
    setDraft(emptyDraft())
    setDialogOpen(true)
  }

  const draftProduct = draft.productId ? productById.get(draft.productId) : undefined

  /** Reçetesi olan ürün bileşen olarak seçilebilir (yarı mamül); yalnızca kendisi hariç. */
  const componentOptions = useMemo(
    () =>
      products
        .filter((p) => p.isActive && !p.isService && p.id !== draft.productId)
        .map((p) => ({ id: p.id, name: p.code ? `${p.name} (${p.code})` : p.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "tr-TR")),
    [products, draft.productId]
  )

  const productOptions = useMemo(
    () =>
      products
        .filter((p) => p.isActive && !p.isService)
        .map((p) => ({
          id: p.id,
          name: `${p.name}${recipeByProduct.has(p.id) ? " — reçetesi var" : ""}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "tr-TR")),
    [products, recipeByProduct]
  )

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    }))
  }

  function selectComponent(key: string, componentId: string) {
    const component = productById.get(componentId)
    // Birim, bileşenin stok birimiyle başlar; kullanıcı aynı aileden (KG↔GR)
    // başka bir birime geçebilir. Aile dışına çıkması engellenir.
    patchItem(key, {
      componentProductId: componentId,
      unit: component?.unit ? normalizeUnitCode(component.unit) : "",
    })
  }

  function addItem() {
    setDraft((d) => ({
      ...d,
      items: [
        ...d.items,
        { key: nextKey(), componentProductId: "", quantity: "", unit: "", wastageRate: "" },
      ],
    }))
  }

  function removeItem(key: string) {
    setDraft((d) => ({ ...d, items: d.items.filter((it) => it.key !== key) }))
  }

  /** Kaydedilebilir (bileşeni + geçerli miktarı olan) kalemler. */
  const validDraftItems = useMemo(
    () =>
      draft.items
        .filter((it) => it.componentProductId && num(it.quantity) > 0)
        .map((it) => ({
          componentProductId: it.componentProductId,
          quantity: num(it.quantity),
          unit: normalizeUnitCode(it.unit),
          wastageRate: it.wastageRate.trim() === "" ? null : num(it.wastageRate),
        })),
    [draft.items]
  )

  /**
   * Taslak, kayıtlı reçetelerin üzerine bindirilerek canlı maliyet hesaplanır.
   * Kullanıcı kaydetmeden önce marjı görebilsin diye.
   */
  const preview = useMemo(() => {
    if (!draft.productId) return null
    const map: RecipeMap = new Map(recipeMap)
    if (validDraftItems.length > 0 && draft.isActive) {
      map.set(draft.productId, {
        yieldQuantity: num(draft.yieldQuantity) > 0 ? num(draft.yieldQuantity) : 1,
        isActive: true,
        items: validDraftItems,
      })
    } else {
      map.delete(draft.productId)
    }
    return costOf(draft.productId, map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.productId, draft.yieldQuantity, draft.isActive, validDraftItems, recipeMap, productById])

  /**
   * Döngü kontrolünün istemci önizlemesi. Sunucu kayıt anında zaten reddediyor
   * (assertNoRecipeCycle); buradaki amaç kullanıcıya hatayı kaydetmeden önce
   * göstermek. Sunucudaki mantıkla aynı: bileşenden ürüne ulaşılabiliyorsa döngü.
   */
  const cycleWarning = useMemo(() => {
    if (!draft.productId) return null
    const withoutDraft: RecipeMap = new Map(recipeMap)
    withoutDraft.delete(draft.productId)
    for (const item of validDraftItems) {
      const path = findRecipePath(item.componentProductId, draft.productId, withoutDraft)
      if (path) {
        const chain = [draft.productId, ...path].map((id) => productById.get(id)?.name ?? id)
        return chain.join(" → ")
      }
    }
    return null
  }, [draft.productId, validDraftItems, recipeMap, productById])

  /** Bileşen birimi, ürünün stok birimine çevrilemiyorsa kayıt reddedilir. */
  const unitProblems = useMemo(() => {
    const problems: string[] = []
    for (const item of draft.items) {
      if (!item.componentProductId || !item.unit) continue
      const component = productById.get(item.componentProductId)
      if (!component) continue
      const allowed = convertibleUnits(component.unit)
      if (!allowed.includes(normalizeUnitCode(item.unit))) {
        problems.push(
          `${component.name}: ${item.unit} → ${component.unit} dönüşümü yapılamıyor`
        )
      }
    }
    return problems
  }, [draft.items, productById])

  const duplicateComponent = useMemo(() => {
    const ids = validDraftItems.map((i) => i.componentProductId)
    return new Set(ids).size !== ids.length
  }, [validDraftItems])

  const canSave =
    !!draft.productId &&
    validDraftItems.length > 0 &&
    !cycleWarning &&
    unitProblems.length === 0 &&
    !duplicateComponent &&
    !saving

  async function handleSave() {
    if (!companyId || !canSave) return
    setSaving(true)
    setServerError(null)
    try {
      const res = await fetch("/api/restoran/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          productId: draft.productId,
          yieldQuantity: num(draft.yieldQuantity) > 0 ? num(draft.yieldQuantity) : 1,
          isActive: draft.isActive,
          note: draft.note,
          items: validDraftItems.map((it, index) => ({ ...it, order: index })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Sunucu hataları Türkçe ve açıklayıcı yazıldı — olduğu gibi gösteriliyor.
        setServerError(data?.error || "Reçete kaydedilemedi")
        return
      }
      toast({ title: editingRecipeId ? "Reçete güncellendi" : "Reçete oluşturuldu" })
      setDialogOpen(false)
      await loadAll()
    } catch {
      setServerError("Sunucuya ulaşılamadı")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(recipe: Recipe) {
    if (!companyId) return
    const name = productById.get(recipe.productId)?.name ?? "Ürün"
    const ok = await confirm({
      title: "Reçete silinsin mi?",
      description: `"${name}" reçetesi silinecek. Bundan sonraki satışlarda ürünün kendisi stoktan düşer. Geçmiş fişler ve stok hareketleri etkilenmez.`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    try {
      const res = await fetch(
        `/api/restoran/recipes/${recipe.id}?companyId=${companyId}`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast({ title: data?.error || "Reçete silinemedi", variant: "destructive" })
        return
      }
      toast({ title: "Reçete silindi" })
      await loadAll()
    } catch {
      toast({ title: "Sunucuya ulaşılamadı", variant: "destructive" })
    }
  }

  /** Ürünü menüden çıkarır / menüye alır (isSellable). */
  async function toggleSellable(product: Product, next: boolean) {
    if (!companyId) return
    // İyimser güncelleme: liste anında tepki versin, hata olursa geri alınır.
    setProducts((list) =>
      list.map((p) => (p.id === product.id ? { ...p, isSellable: next } : p))
    )
    try {
      const res = await fetch(
        `/api/stok/products/${product.id}?companyId=${companyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isSellable: next }),
        }
      )
      if (!res.ok) throw new Error()
    } catch {
      setProducts((list) =>
        list.map((p) => (p.id === product.id ? { ...p, isSellable: !next } : p))
      )
      toast({ title: "Güncellenemedi", variant: "destructive" })
    }
  }

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reçeteler</h1>
          <p className="text-muted-foreground">
            Satışta mamül yerine bileşenleri stoktan düşer; yarı mamüller hammaddeye kadar açılır.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/stok?company=${companyId}`}>
              <PackageSearch className="mr-2 h-4 w-4" />
              Ürünler
            </Link>
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Reçete
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-kobipo-border p-1">
          <button
            type="button"
            onClick={() => setTab("menu")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "menu"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Menü Ürünleri ({menuCount})
          </button>
          <button
            type="button"
            onClick={() => setTab("raw")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "raw"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Hammaddeler ({rawCount})
          </button>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün adı veya kodu"
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Yükleniyor…</CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ChefHat className="h-5 w-5" />
              {tab === "menu" ? "Menü ürünü yok" : "Hammadde yok"}
            </CardTitle>
            <CardDescription>
              {tab === "menu"
                ? "Stok kartlarınızda satışa açık ürün bulunamadı. Önce ürün kartı oluşturun."
                : "Hammadde, menüde görünmeyen üründür. Menü sekmesinden bir ürünün \"Menüde\" anahtarını kapatarak hammaddeye çevirebilirsiniz."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : tab === "menu" ? (
        <MenuTable
          products={filtered}
          recipeByProduct={recipeByProduct}
          costOf={(id) => costOf(id, recipeMap)}
          onEdit={openForProduct}
          onDelete={handleDelete}
          onToggleSellable={toggleSellable}
        />
      ) : (
        <RawTable
          products={filtered}
          usedIn={usedInByComponent}
          // Yarı mamülde alış fiyatı değil, kendi reçetesinin açılmış maliyeti geçerli.
          unitCostOf={(id) => resolvedUnitCost(id, recipeMap)}
          hasRecipe={(id) => recipeByProduct.has(id)}
          onEdit={openForProduct}
          onToggleSellable={toggleSellable}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRecipeId ? "Reçete Düzenle" : "Yeni Reçete"}
              {draftProduct ? ` — ${draftProduct.name}` : ""}
            </DialogTitle>
            <DialogDescription>
              Bir mamülün hangi bileşenlerden oluştuğunu tanımlayın. Bileşenin kendi reçetesi
              varsa satışta o da açılır (yarı mamül).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Ürün</Label>
                {editingRecipeId ? (
                  <Input value={draftProduct?.name ?? ""} disabled />
                ) : (
                  <SearchSelect
                    options={productOptions}
                    value={draft.productId}
                    onChange={(id) => setDraft((d) => ({ ...d, productId: id }))}
                    placeholder="Reçetesi tanımlanacak ürünü seçin"
                    emptyText="Ürün bulunamadı"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="yieldQuantity">
                  Üretim Miktarı{draftProduct ? ` (${draftProduct.unit})` : ""}
                </Label>
                <Input
                  id="yieldQuantity"
                  value={draft.yieldQuantity}
                  onChange={(e) => setDraft((d) => ({ ...d, yieldQuantity: e.target.value }))}
                  inputMode="decimal"
                  placeholder="1"
                />
                <p className="text-xs text-muted-foreground">
                  Aşağıdaki bileşenler kaç adet mamül üretir.
                </p>
              </div>
            </div>

            {draft.productId && recipeByProduct.has(draft.productId) && !editingRecipeId && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Bu ürünün zaten bir reçetesi var. Kaydederseniz mevcut reçetenin bileşenleri
                  tamamen bunlarla değiştirilir.
                </span>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Bileşenler</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Bileşen Ekle
                </Button>
              </div>

              <div className="space-y-2">
                {draft.items.map((item) => {
                  const component = item.componentProductId
                    ? productById.get(item.componentProductId)
                    : undefined
                  const unitOptions = component ? convertibleUnits(component.unit) : []
                  const isSemiFinished = component ? recipeByProduct.has(component.id) : false
                  // Yarı mamülde alış fiyatı değil, kendi reçetesinin maliyeti geçerli.
                  const unitCost = component ? resolvedUnitCost(component.id, recipeMap) : null
                  const q = num(item.quantity)
                  const wastage = item.wastageRate.trim() === "" ? 0 : num(item.wastageRate)
                  // Satır maliyeti bileşenin KENDİ stok birimine çevrilerek hesaplanır
                  // (reçetede 20 GR yazsa da kahve KG stoklanıyor olabilir). Dönüşüm
                  // yapılamıyorsa null — o durumda zaten unitProblems uyarısı çıkıyor.
                  const convertedQty =
                    component && Number.isFinite(q) && q > 0
                      ? convertUnit(
                          q * (1 + (Number.isFinite(wastage) ? wastage : 0) / 100),
                          item.unit,
                          component.unit
                        )
                      : null
                  const lineCost =
                    unitCost != null && convertedQty != null ? convertedQty * unitCost : null

                  return (
                    <div
                      key={item.key}
                      className="grid grid-cols-1 gap-2 rounded-lg border border-kobipo-border p-3 sm:grid-cols-12 sm:items-end"
                    >
                      <div className="space-y-1.5 sm:col-span-5">
                        <Label className="text-xs text-muted-foreground">Bileşen</Label>
                        <SearchSelect
                          options={componentOptions}
                          value={item.componentProductId}
                          onChange={(id) => selectComponent(item.key, id)}
                          placeholder="Ürün seçin"
                          emptyText="Ürün bulunamadı"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs text-muted-foreground">Miktar</Label>
                        <Input
                          value={item.quantity}
                          onChange={(e) => patchItem(item.key, { quantity: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs text-muted-foreground">Birim</Label>
                        <Select
                          value={item.unit}
                          onValueChange={(v) => patchItem(item.key, { unit: v })}
                          disabled={!component}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {unitOptions.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs text-muted-foreground">Fire %</Label>
                        <Input
                          value={item.wastageRate}
                          onChange={(e) => patchItem(item.key, { wastageRate: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                        />
                      </div>
                      <div className="flex items-center justify-end sm:col-span-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.key)}
                          aria-label="Bileşeni kaldır"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {component && (
                        <div className="text-xs text-muted-foreground sm:col-span-12">
                          Stok birimi <strong>{component.unit}</strong>
                          {!isSemiFinished && ` · Stok ${qty(component.stockQuantity)}`}
                          {unitCost != null
                            ? ` · Birim maliyet ${money(unitCost)}/${component.unit}`
                            : " · Alış fiyatı girilmemiş"}
                          {lineCost != null ? ` · Satır maliyeti ${money(lineCost)}` : ""}
                          {isSemiFinished ? " · Yarı mamül (hammaddeye kadar açılacak)" : ""}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="note">Not</Label>
                <Textarea
                  id="note"
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder="Hazırlık notu, porsiyon açıklaması…"
                  rows={3}
                />
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    id="isActive"
                    checked={draft.isActive}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, isActive: v }))}
                  />
                  <Label htmlFor="isActive" className="cursor-pointer text-sm font-normal">
                    Aktif — kapalıyken satışta ürünün kendisi düşer
                  </Label>
                </div>
              </div>

              <CostSummary
                preview={preview}
                salePrice={draftProduct?.salePrice ?? null}
                yieldQuantity={num(draft.yieldQuantity) > 0 ? num(draft.yieldQuantity) : 1}
                unit={draftProduct?.unit}
              />
            </div>

            {(cycleWarning || unitProblems.length > 0 || duplicateComponent || serverError) && (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {cycleWarning && <p>Reçete döngüsü oluşur: {cycleWarning}</p>}
                {duplicateComponent && <p>Aynı bileşen birden fazla kez eklenemez.</p>}
                {unitProblems.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {serverError && <p>{serverError}</p>}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Vazgeç
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type CostResult = {
  total: number
  /** Alış fiyatı girilmemiş bileşen adları — maliyet eksik hesaplanmış demektir. */
  priceless: string[]
  /** Kullanıcıya gösterilebilir hata metinleri (döngü, birim, derinlik). */
  errors: string[]
  hasRecipe: boolean
}

function CostSummary({
  preview,
  salePrice,
  yieldQuantity,
  unit,
}: {
  preview: CostResult | null
  salePrice: number | null
  yieldQuantity: number
  unit?: string
}) {
  if (!preview || !preview.hasRecipe) {
    return (
      <div className="rounded-lg border border-kobipo-border bg-kobipo-offwhite/50 p-4 text-sm text-muted-foreground dark:bg-white/5">
        Bileşen ekledikçe birim maliyet ve kâr marjı burada hesaplanır.
      </div>
    )
  }

  const cost = preview.total
  const profit = salePrice != null ? salePrice - cost : null
  const margin = salePrice != null && salePrice > 0 ? ((salePrice - cost) / salePrice) * 100 : null

  return (
    <div className="space-y-2 rounded-lg border border-kobipo-border bg-kobipo-offwhite/50 p-4 text-sm dark:bg-white/5">
      <Row label={`Birim maliyet${unit ? ` (1 ${unit})` : ""}`} value={money(cost)} strong />
      {yieldQuantity !== 1 && (
        <Row label={`Parti maliyeti (${qty(yieldQuantity)} birim)`} value={money(cost * yieldQuantity)} />
      )}
      <Row
        label="Satış fiyatı (KDV hariç)"
        value={salePrice != null ? money(salePrice) : "girilmemiş"}
      />
      {profit != null && <Row label="Brüt kâr" value={money(profit)} strong />}
      {margin != null && (
        <Row
          label="Marj"
          value={`%${margin.toFixed(1)}`}
          strong
          tone={margin < 0 ? "bad" : margin < 20 ? "warn" : "good"}
        />
      )}

      {preview.priceless.length > 0 && (
        <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">
          Alış fiyatı girilmemiş: {preview.priceless.join(", ")} — maliyet eksik hesaplanıyor.
        </p>
      )}
      {preview.errors.length > 0 && (
        <div className="space-y-0.5 pt-1 text-xs text-red-600 dark:text-red-400">
          {preview.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: "good" | "warn" | "bad"
}) {
  const toneClass =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "good"
          ? "text-emerald-600 dark:text-emerald-400"
          : ""
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""} ${toneClass}`}>{value}</span>
    </div>
  )
}

function MenuTable({
  products,
  recipeByProduct,
  costOf,
  onEdit,
  onDelete,
  onToggleSellable,
}: {
  products: Product[]
  recipeByProduct: Map<string, Recipe>
  costOf: (productId: string) => { total: number; priceless: string[]; hasRecipe: boolean }
  onEdit: (p: Product) => void
  onDelete: (r: Recipe) => void
  onToggleSellable: (p: Product, next: boolean) => void
}) {
  return (
    <StyledTableContainer>
      <Table>
        <TableHeader>
          <StyledTableHeaderRow>
            <StyledTableHead>Ürün</StyledTableHead>
            <StyledTableHead>Reçete</StyledTableHead>
            <StyledTableHead className="text-right">Maliyet</StyledTableHead>
            <StyledTableHead className="text-right">Satış</StyledTableHead>
            <StyledTableHead className="text-right">Marj</StyledTableHead>
            <StyledTableHead className="text-right">İşlem</StyledTableHead>
          </StyledTableHeaderRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const recipe = recipeByProduct.get(p.id)
            const c = recipe ? costOf(p.id) : null
            const sale = p.salePrice != null ? Number(p.salePrice) : null
            const margin =
              c && sale != null && sale > 0 ? ((sale - c.total) / sale) * 100 : null
            return (
              <StyledTableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {p.code && (
                      <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {/* Reçeteli ürün kendi stoğundan düşmez — bakiyesini göstermek yanıltıcı. */}
                    {p.unit}
                    {!recipe && ` · Stok ${qty(p.stockQuantity)}`}
                  </span>
                </TableCell>
                <TableCell>
                  {recipe ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={recipe.isActive ? "aktif" : "secondary"}>
                        {recipe.isActive ? `${recipe.items.length} bileşen` : "Pasif"}
                      </Badge>
                      {!recipe.isActive && (
                        <span className="text-xs text-muted-foreground">
                          ürünün kendisi düşer
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Reçete yok</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c ? (
                    <span className={c.priceless.length > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
                      {money(c.total)}
                      {c.priceless.length > 0 && "*"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {sale != null ? money(sale) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {margin != null ? (
                    <span
                      className={
                        margin < 0
                          ? "text-red-600 dark:text-red-400"
                          : margin < 20
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      %{margin.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(p)}
                      title={recipe ? "Reçeteyi düzenle" : "Reçete ekle"}
                    >
                      {recipe ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <>
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          <span className="text-xs">Reçete</span>
                        </>
                      )}
                    </Button>
                    {recipe && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(recipe)}
                        title="Reçeteyi sil"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                    <div className="ml-2 flex items-center gap-1.5" title="Menüde göster">
                      <Switch
                        checked={p.isSellable}
                        onCheckedChange={(v) => onToggleSellable(p, v)}
                      />
                    </div>
                  </div>
                </TableCell>
              </StyledTableRow>
            )
          })}
        </TableBody>
      </Table>
    </StyledTableContainer>
  )
}

function RawTable({
  products,
  usedIn,
  unitCostOf,
  hasRecipe,
  onEdit,
  onToggleSellable,
}: {
  products: Product[]
  usedIn: Map<string, string[]>
  unitCostOf: (productId: string) => number | null
  hasRecipe: (productId: string) => boolean
  onEdit: (p: Product) => void
  onToggleSellable: (p: Product, next: boolean) => void
}) {
  return (
    <StyledTableContainer>
      <Table>
        <TableHeader>
          <StyledTableHeaderRow>
            <StyledTableHead>Ürün</StyledTableHead>
            <StyledTableHead className="text-right">Stok</StyledTableHead>
            <StyledTableHead className="text-right">Birim Maliyet</StyledTableHead>
            <StyledTableHead>Kullanıldığı Reçeteler</StyledTableHead>
            <StyledTableHead className="text-right">Menüde</StyledTableHead>
          </StyledTableHeaderRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const cost = unitCostOf(p.id)
            const parents = usedIn.get(p.id) ?? []
            // Yarı mamül SANALDIR: stok bakiyesi tutulmaz, satışta üzerinden
            // geçilip hammaddeye inilir. Sayı göstermek yanıltıcı olurdu.
            const isSemiFinished = hasRecipe(p.id)
            return (
              <StyledTableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {isSemiFinished && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-kobipo-pale px-2 py-0.5 text-[11px] font-semibold text-kobipo-blue">
                        <Layers className="h-3 w-3" />
                        Yarı mamül
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{p.unit}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {isSemiFinished ? (
                    <span className="text-muted-foreground" title="Yarı mamül sanaldır; stok bakiyesi tutulmaz">
                      —
                    </span>
                  ) : (
                    qty(p.stockQuantity)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {cost != null ? (
                    `${money(cost)}/${p.unit}`
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">girilmemiş</span>
                  )}
                </TableCell>
                <TableCell>
                  {parents.length > 0 ? (
                    <span className="text-xs text-muted-foreground">{parents.join(", ")}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">
                      hiçbir reçetede kullanılmıyor
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {isSemiFinished && (
                      <Button variant="ghost" size="icon" onClick={() => onEdit(p)} title="Reçeteyi düzenle">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <Switch
                      checked={p.isSellable}
                      onCheckedChange={(v) => onToggleSellable(p, v)}
                    />
                  </div>
                </TableCell>
              </StyledTableRow>
            )
          })}
        </TableBody>
      </Table>
    </StyledTableContainer>
  )
}
