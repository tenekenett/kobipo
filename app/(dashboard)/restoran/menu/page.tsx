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

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import {
  ChefHat,
  Plus,
  Pencil,
  Trash2,
  Search,
  AlertTriangle,
  X,
  EyeOff,
  ImagePlus,
  Layers,
  PackageSearch,
  ShoppingCart,
  Tags,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { SearchSelect } from "@/components/ui/search-select"
import { TextCombobox } from "@/components/ui/text-combobox"
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
import {
  UNIT_OPTIONS,
  convertUnit,
  convertibleUnits,
  defaultRecipeUnit,
  normalizeUnitCode,
  recipeUnitOptions,
  unitShortLabel,
} from "@/lib/data/units"
import { quickCreateProduct, type CreatedProduct } from "@/lib/stock/quick-create-product"
import { RawMaterialDialog } from "@/components/restoran/raw-material-dialog"
import { ProductOptionsDialog } from "@/components/restoran/product-options-dialog"
import { grossPrice } from "@/components/restoran/menu-grid"
import { ProductImageField } from "@/components/stok/product-image-field"
import { CategoryManagerDialog } from "@/components/stok/category-manager-dialog"
import { cn } from "@/lib/utils"
import {
  buildRecipeMap,
  describeExpandError,
  expandRecipeLines,
  findRecipePath,
  type RecipeMap,
} from "@/lib/stock/recipe-expand"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useProductOptions } from "@/lib/swr/use-restoran"
import {
  useProductCategories,
  useProducts,
  useRecipes,
  type RefProduct,
  type RefRecipe,
} from "@/lib/swr/use-company-data"
import { money, parseNum, qty } from "@/lib/format"
import {
  flagsForKind,
  productKindLabel,
  productKindOf,
  productKindOptions,
  type ProductKind,
} from "@/lib/stock/product-kind"

// Ürün ve reçete tipleri SWR katmanından geliyor (lib/swr/use-company-data.ts).
// Eskiden bu dosyada birer kopyası vardı; Decimal→number normalizasyonu da
// burada tekrar yazılmıştı. Tek tanım = iki ekranın ayrışmaması demek.
type Product = RefProduct
type Recipe = RefRecipe

/** Dialog içindeki düzenlenebilir kalem — miktar/fire ham metin olarak tutulur. */
type DraftItem = {
  key: string
  componentProductId: string
  quantity: string
  unit: string
  wastageRate: string
}

/** Yeni menü ürünü alanları — `mode === "new"` iken kullanılır. */
type NewProductDraft = {
  name: string
  category: string
  salePrice: string
  vatRate: string
  unit: string
  /**
   * Yüklenmiş fotoğrafın URL'i (henüz hiçbir ürüne bağlı değil). Ürün kaydı
   * açılırken birlikte yazılır — diyalog kapatılırsa depoda yetim bir nesne
   * kalır, bu kabul edildi: alternatifi kaydetmeden önce yükleme yapmamak,
   * yani kullanıcıya fotoğrafı önizletmemekti.
   */
  imageUrl: string | null
}

type Draft = {
  /**
   * `new`  → menü ürünü bu diyalogda YARATILIR (asıl akış: menü kalemi zaten
   *          bir stok ürünü değildir, reçeteyle birlikte doğar).
   * `existing` → var olan bir ürüne reçete bağlanır (hammaddeyi mamüle çevirme,
   *          ya da eskiden Stok'tan açılmış kartlar için).
   */
  mode: "new" | "existing"
  productId: string
  newProduct: NewProductDraft
  /**
   * Reçete İSTEĞE BAĞLI. Şişe su / kutu kola menüde durur ama reçetesi yoktur —
   * satışta kendisi stoktan düşer. Reçeteyi zorunlu kılmak bu ürünler için
   * "menüdeki su + stoktaki su" diye çift kayıt gerektirirdi.
   */
  hasRecipe: boolean
  yieldQuantity: string
  isActive: boolean
  note: string
  items: DraftItem[]
}

/** Kategori süzgecinin özel değerleri — Select boş string kabul etmiyor. */
const ALL_CATEGORIES = "__ALL__"
const NO_CATEGORY = "__NONE__"

/** Dialog girdilerinde "12,5" ve "12.5" ikisi de kabul edilir. */
const num = parseNum

let keySeq = 0
const nextKey = () => `i${++keySeq}`

/**
 * Yeni ürünün henüz id'si yok; maliyet önizlemesi reçete ağacına onu geçici bir
 * anahtarla koyar. Gerçek bir cuid ile çakışmayacak biçimde seçildi.
 */
const NEW_PRODUCT_KEY = "__yeni_urun__"

const emptyNewProduct = (): NewProductDraft => ({
  name: "",
  category: "",
  salePrice: "",
  vatRate: "20",
  unit: "ADET",
  imageUrl: null,
})

const blankItem = (): DraftItem => ({
  key: nextKey(),
  componentProductId: "",
  quantity: "",
  unit: "",
  wastageRate: "",
})

function emptyDraft(productId = "", mode: "new" | "existing" = "existing"): Draft {
  return {
    mode,
    productId,
    newProduct: emptyNewProduct(),
    // Var olan ürüne reçete bağlanıyorsa niyet zaten reçete kurmaktır.
    hasRecipe: true,
    yieldQuantity: "1",
    isActive: true,
    note: "",
    items: [blankItem()],
  }
}

export default function ReceptelerPage() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [tab, setTab] = useState<"menu" | "raw">("menu")
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  /** Düzenlenen mevcut reçetenin id'si; yeni reçetede null. */
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const [rawDialogOpen, setRawDialogOpen] = useState(false)
  /**
   * Hammadde diyaloğu bir bileşen satırından açıldıysa o satırın anahtarı.
   * Oluşturulan hammadde doğrudan o satıra yazılır — kullanıcı reçeteyi bölüp
   * Stok ekranına gitmek zorunda kalmasın.
   */
  const [rawTargetKey, setRawTargetKey] = useState<string | null>(null)

  // Referans veriler SWR katmanından (lib/swr/use-company-data.ts). Kahveci satış
  // ekranı da AYNI anahtarları kullanıyor; kaydettikten sonra `mutate` çağırınca
  // orası da anında tazeleniyor. Eskiden bu sayfa elle fetch ediyordu ve satış
  // ekranı, odak değişene kadar ESKİ reçeteyi tutuyordu.
  //
  // companyId, URL'deki `?company=` yerine sağlayıcıdan alınır: sağlayıcı slug'ı
  // cuid'e normalize ediyor, URL ise slug taşıyabiliyor — ikisi farklı SWR
  // anahtarı üretir ve ortak önbellek çalışmazdı.
  const { products, isLoading: productsLoading, mutate: mutateProducts } = useProducts(companyId)
  // Seçenek (porsiyon/modifier) tanımları — satır bazında düzenlenir.
  const { groupsOf, mutate: mutateOptions } = useProductOptions(companyId)
  const [optionsFor, setOptionsFor] = useState<{
    id: string
    name: string
    basePrice: number | null
  } | null>(null)
  /** Fotoğrafı düzenlenen ürün — satırdaki küçük görselden açılır. */
  const [imageFor, setImageFor] = useState<{ id: string; name: string } | null>(null)
  const { recipes, isLoading: recipesLoading, mutate: mutateRecipes } = useRecipes(companyId)
  const loading = productsLoading || recipesLoading

  const refresh = useCallback(async () => {
    await Promise.all([mutateProducts(), mutateRecipes()])
  }, [mutateProducts, mutateRecipes])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const recipeByProduct = useMemo(() => new Map(recipes.map((r) => [r.productId, r])), [recipes])

  /**
   * Bileşenin birim maliyeti — AVCO. `avgPurchasePrice` alanı ürün ucundan
   * zaten tek tanımla geliyor (lib/stock/cost.ts) ve alış fiyatına düşme de
   * orada yapılıyor; burada ikinci bir fallback yazmak iki tanım demekti.
   * null = maliyet bilinmiyor (0 DEĞİL) — çağıran "fiyatsız" olarak raporlar.
   */
  function unitCostOf(productId: string): number | null {
    const avg = productById.get(productId)?.avgPurchasePrice
    return avg != null && Number.isFinite(Number(avg)) ? Number(avg) : null
  }

  const unitOf = (productId: string) => productById.get(productId)?.unit ?? null

  /**
   * Kayıtlı reçeteler → genişletme haritası. Sunucudaki loadRecipeContext ile
   * aynı şekilde YALNIZCA aktif reçeteler alınır; pasif reçete satışta da
   * açılmadığı için maliyeti de açılmamış gibi hesaplanmalı. Bu kural tek yerde
   * (buildRecipeMap) yaşıyor — satış ekranı da aynı haritayı kuruyor.
   */
  const recipeMap = useMemo<RecipeMap>(() => buildRecipeMap(recipes), [recipes])

  /**
   * Bir mamülün 1 birimlik maliyeti. Çok seviyeli reçetede ara katlar
   * (Espresso) kendiliğinden açılır — expandRecipeLines hammaddeye kadar iner.
   */
  const nameOf = (productId: string) => productById.get(productId)?.name ?? productId

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
      errors: errors.map((e) => describeExpandError(e, nameOf)),
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

  /**
   * Süzgeçteki kategoriler AKTİF SEKMENİN ürünlerinden üretilir: menü sekmesinde
   * hammadde kategorilerini, hammadde sekmesinde menü kategorilerini listelemek
   * kullanıcıya boş sonuç verdiren seçenekler sunardı.
   */
  const filterCategories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      if (!p.isActive || p.isService) continue
      if (tab === "menu" ? !p.isSellable : !p.isIngredient) continue
      const c = p.category?.trim()
      if (c) set.add(c)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr-TR"))
  }, [products, tab])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    return products
      .filter((p) => p.isActive && !p.isService)
      .filter(
        (p) =>
          categoryFilter === ALL_CATEGORIES ||
          (categoryFilter === NO_CATEGORY
            ? !p.category?.trim()
            : p.category?.trim() === categoryFilter)
      )
      // Sekmeler AYRI bayraklara bakar ve birbirini dışlamaz: hem menüde satılan
      // hem reçetede kullanılan bir ürün (paket kahve çekirdeği) İKİ sekmede de
      // görünür. Eskiden "Hammaddeler" = !isSellable idi ve o ürün kayboluyordu.
      .filter((p) => (tab === "menu" ? p.isSellable : p.isIngredient))
      .filter((p) => !q || p.name.toLocaleLowerCase("tr-TR").includes(q) || (p.code ?? "").toLocaleLowerCase("tr-TR").includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"))
  }, [products, tab, search, categoryFilter])

  const menuCount = products.filter((p) => p.isActive && !p.isService && p.isSellable).length
  const rawCount = products.filter((p) => p.isActive && !p.isService && p.isIngredient).length

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
        ...emptyDraft(existing.productId),
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

  /**
   * "Yeni Menü Ürünü" — varsayılan olarak ÜRÜN OLUŞTURMA modunda açılır.
   * Menü kalemi zaten var olan bir stok ürünü değildir; reçetesiyle birlikte
   * doğar. Var olan bir ürüne reçete bağlamak isteyen diyalog içinden
   * "Mevcut üründen seç"e geçebilir.
   */
  function openNew() {
    setServerError(null)
    setEditingRecipeId(null)
    setDraft(emptyDraft("", "new"))
    setDialogOpen(true)
  }

  const draftProduct = draft.productId ? productById.get(draft.productId) : undefined

  /** Yeni üründe henüz id yok — maliyet/döngü hesapları geçici anahtarı kullanır. */
  const draftKey = draft.mode === "new" ? NEW_PRODUCT_KEY : draft.productId
  /** Reçete birimi etiketleri: yeni üründe formdaki birim, mevcutta ürün kartındaki. */
  const draftUnit = draft.mode === "new" ? draft.newProduct.unit : draftProduct?.unit ?? ""

  /**
   * Marj önizlemesi için NET satış fiyatı. Yeni üründe kullanıcı henüz
   * kaydetmedi, o yüzden formdan okunur; KDV dahil girildiyse net'e çevrilir —
   * DB net saklıyor ve maliyet de net, aksi halde marj olduğundan düşük çıkardı.
   */
  const draftSalePrice = useMemo(() => {
    if (draft.mode !== "new") return draftProduct?.salePrice ?? null
    const raw = num(draft.newProduct.salePrice)
    if (!Number.isFinite(raw) || raw <= 0) return null
    const vat = num(draft.newProduct.vatRate)
    const safeVat = Number.isFinite(vat) ? vat : 0
    // Fiyat DAİMA KDV dahil giriliyor (alan etiketi de öyle diyor); maliyet net
    // olduğundan marjın doğru çıkması için net tabana indiriliyor.
    return safeVat > 0 ? raw / (1 + safeVat / 100) : raw
  }, [draft.mode, draft.newProduct, draftProduct])

  /**
   * Yeni ürün formundaki kategori önerileri.
   *
   * İKİ kaynak birleşir: Stok ekranından yönetilen kategori tanımları
   * (CompanyDefinition) ve ürünlerde fiilen kullanılan etiketler. Eskiden yalnız
   * ikincisi vardı — Stok'ta tanımlanmış ama henüz hiçbir ürüne verilmemiş bir
   * kategori burada hiç görünmüyordu, kullanıcı da onu elle yeniden yazıyordu.
   */
  const { categories: definedCategories, mutate: mutateCategories } =
    useProductCategories(companyId)
  const menuCategories = useMemo(() => {
    const set = new Set<string>()
    for (const c of definedCategories) if (c.trim()) set.add(c.trim())
    for (const p of products) if (p.category?.trim()) set.add(p.category.trim())
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr-TR"))
  }, [definedCategories, products])

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

  /** Seçenek reçete etkisinde seçilebilecek kartlar (birimiyle: ekleme miktarı için). */
  const effectProducts = useMemo(
    () =>
      products
        .filter((p) => p.isActive && !p.isService)
        .map((p) => ({ id: p.id, name: p.name, unit: p.unit })),
    [products]
  )

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    }))
  }

  function selectComponent(key: string, componentId: string) {
    const component = productById.get(componentId)
    // Birim, ailenin KÜÇÜK biriminde başlar (süt LT stoklansa da reçetede ML).
    // Eskiden stok birimiyle başlıyordu ve "200" yazan kullanıcı 200 ml yerine
    // 200 LİTRE giriyordu — bkz. defaultRecipeUnit().
    const nextUnit = defaultRecipeUnit(component?.unit)
    setDraft((d) => ({
      ...d,
      items: d.items.map((it) => {
        if (it.key !== key) return it
        // Birim değiştiyse eldeki miktar artık BAŞKA bir şey ifade eder: "200 ml
        // süt" satırı kahveye çevrildiğinde sessizce "200 g kahve" olarak
        // kalıyordu. Miktar temizlenip yeniden sorulur.
        const unitChanged = normalizeUnitCode(it.unit) !== normalizeUnitCode(nextUnit)
        return {
          ...it,
          componentProductId: componentId,
          unit: nextUnit,
          quantity: unitChanged ? "" : it.quantity,
        }
      }),
    }))
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

  /** Bileşen satırından "yeni hammadde": diyalog kapanınca satıra kendisi yazılır. */
  function openRawDialogFor(itemKey: string | null) {
    setRawTargetKey(itemKey)
    setRawDialogOpen(true)
  }

  async function handleRawCreated(created: CreatedProduct) {
    // Önce liste tazelenir ki yeni hammadde seçeneklerde görünsün; ancak ondan
    // sonra satıra yazmak anlamlı (SearchSelect adı listeden okuyor).
    await refresh()
    if (rawTargetKey) {
      // Birim `selectComponent` ile AYNI kuraldan gelir: ailenin küçük birimi.
      // Burada stok birimini yazmak (eskiden öyleydi) "200 LT süt" hatasını
      // ikinci bir kapıdan geri getirirdi — bkz. defaultRecipeUnit().
      patchItem(rawTargetKey, {
        componentProductId: created.id,
        unit: defaultRecipeUnit(created.unit),
      })
      setRawTargetKey(null)
    }
    toast({ title: `"${created.name}" hammadde olarak eklendi` })
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
    if (!draftKey) return null
    const map: RecipeMap = new Map(recipeMap)
    if (validDraftItems.length > 0 && draft.isActive) {
      map.set(draftKey, {
        yieldQuantity: num(draft.yieldQuantity) > 0 ? num(draft.yieldQuantity) : 1,
        isActive: true,
        items: validDraftItems,
      })
    } else {
      map.delete(draftKey)
    }
    return costOf(draftKey, map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, draft.yieldQuantity, draft.isActive, validDraftItems, recipeMap, productById])

  /**
   * Döngü kontrolünün istemci önizlemesi. Sunucu kayıt anında zaten reddediyor
   * (assertNoRecipeCycle); buradaki amaç kullanıcıya hatayı kaydetmeden önce
   * göstermek. Sunucudaki mantıkla aynı: bileşenden ürüne ulaşılabiliyorsa döngü.
   */
  const cycleWarning = useMemo(() => {
    // Yeni ürüne hiçbir reçete referans veremez (henüz yok) → döngü imkânsız.
    if (draft.mode === "new" || !draft.productId) return null
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
  }, [draft.mode, draft.productId, validDraftItems, recipeMap, productById])

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

  /**
   * Var olan ürüne bağlanıyorsak diyaloğun tek amacı reçetedir → zorunlu.
   * Yeni üründe kullanıcı "hammaddelerden hazırlanır" anahtarını kapatabilir
   * (şişe su, kutu kola: menüde durur, satışta kendisi düşer).
   */
  const recipeRequired = draft.mode === "existing" || draft.hasRecipe

  const hasSubject =
    draft.mode === "new" ? draft.newProduct.name.trim().length > 0 : !!draft.productId

  const canSave =
    hasSubject &&
    (!recipeRequired || validDraftItems.length > 0) &&
    !cycleWarning &&
    unitProblems.length === 0 &&
    !duplicateComponent &&
    !saving

  async function handleSave() {
    if (!companyId || !canSave) return
    setSaving(true)
    setServerError(null)
    try {
      // 1) Menü ürünü bu diyalogda doğuyorsa önce ürün kartı açılır. Menü kalemi
      //    her zaman bir Product'tır (satış InvoiceItem.productId yazar, stok
      //    hareketi ve raporlar ürüne bağlıdır) — ama kullanıcının bunun için
      //    Stok ekranına gitmesi gerekmiyor.
      let productId = draft.productId
      if (draft.mode === "new") {
        const created = await quickCreateProduct({
          companyId,
          name: draft.newProduct.name,
          category: draft.newProduct.category.trim() || null,
          unit: draft.newProduct.unit,
          vatRate: draft.newProduct.vatRate,
          salePrice: draft.newProduct.salePrice.trim()
            ? draft.newProduct.salePrice.replace(",", ".")
            : null,
          salePriceVatIncluded: true,
          // Menü ürünü: kahveci ızgarasında ve hızlı satışta listelenir.
          isSellable: true,
          imageUrl: draft.newProduct.imageUrl,
        })
        productId = created.id
      }

      // 2) Reçete (varsa). Reçetesiz menü ürünü tamamen geçerlidir.
      if (recipeRequired) {
        const res = await fetch("/api/restoran/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            productId,
            yieldQuantity: num(draft.yieldQuantity) > 0 ? num(draft.yieldQuantity) : 1,
            isActive: draft.isActive,
            note: draft.note,
            items: validDraftItems.map((it, index) => ({ ...it, order: index })),
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          // Ürün oluştu ama reçete olmadıysa ortada yetim bir kart kalır; kullanıcı
          // bunu bilsin ki aynı adla ikinci kez oluşturmaya çalışmasın (isim
          // benzersizliği sunucuda zorunlu, ikinci deneme 409 alırdı).
          setServerError(
            draft.mode === "new"
              ? `Ürün oluşturuldu ama reçetesi kaydedilemedi: ${data?.error || "bilinmeyen hata"}. Ürün menüde reçetesiz duruyor; satırdaki "Reçete" düğmesinden tekrar deneyebilirsiniz.`
              : data?.error || "Reçete kaydedilemedi"
          )
          if (draft.mode === "new") await refresh()
          return
        }
      }

      toast({
        title:
          draft.mode === "new"
            ? recipeRequired
              ? "Menü ürünü ve reçetesi oluşturuldu"
              : "Menü ürünü oluşturuldu"
            : editingRecipeId
              ? "Reçete güncellendi"
              : "Reçete oluşturuldu",
      })
      setDialogOpen(false)
      await refresh()
    } catch (e: any) {
      setServerError(e?.message || "Sunucuya ulaşılamadı")
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
      await refresh()
    } catch {
      toast({ title: "Sunucuya ulaşılamadı", variant: "destructive" })
    }
  }

  /**
   * Ürünün türünü değiştirir (menü / hammadde / her ikisi). Üç bayrağı tek
   * seferde yazar — ayrı ayrı yazılsaydı ara adımda ürün geçici olarak hiçbir
   * sekmede görünmeyen bir duruma düşebilirdi.
   *
   * İyimser güncelleme: liste anında tepki verir, hata olursa geri alınır.
   * `revalidate: false` — sunucuya sormadan yalnız yerel önbelleği oynat;
   * doğrulama başarılı yanıttan sonra tek seferde yapılır.
   */
  async function changeKind(product: Product, kind: ProductKind) {
    if (!companyId) return
    const next = flagsForKind(kind)
    const before = {
      isService: product.isService === true,
      isSellable: product.isSellable,
      isIngredient: product.isIngredient,
    }
    const patch = (list: any[] | undefined, flags: typeof next) =>
      (list ?? []).map((p: any) => (p.id === product.id ? { ...p, ...flags } : p))

    await mutateProducts((list) => patch(list, next), { revalidate: false })
    try {
      const res = await fetch(
        `/api/stok/products/${product.id}?companyId=${companyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }
      )
      if (!res.ok) throw new Error()
      await mutateProducts()
    } catch {
      await mutateProducts((list) => patch(list, before as typeof next), { revalidate: false })
      toast({ title: "Güncellenemedi", variant: "destructive" })
    }
  }

  /**
   * Fotoğrafı ürüne yazar. PUT değil PATCH: PUT gövdesinde gelmeyen fiyat/stok
   * alanlarını sıfırlar, fotoğraf değiştirmek fiyat silmemeli.
   *
   * İyimser güncelleme — changeKind ile aynı desen: liste anında tepki verir,
   * hata olursa geri alınır. Diyalogdaki önizleme de bu önbellekten besleniyor.
   */
  async function saveProductImage(productId: string, imageUrl: string | null) {
    if (!companyId) return
    const before = productById.get(productId)?.imageUrl ?? null
    const patch = (list: any[] | undefined, url: string | null) =>
      (list ?? []).map((p: any) => (p.id === productId ? { ...p, imageUrl: url } : p))

    await mutateProducts((list) => patch(list, imageUrl), { revalidate: false })
    try {
      const res = await fetch(`/api/stok/products/${productId}?companyId=${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as any)
        throw new Error(data?.error || "Fotoğraf kaydedilemedi")
      }
      await mutateProducts()
    } catch (e: any) {
      await mutateProducts((list) => patch(list, before), { revalidate: false })
      // Hata ProductImageField'a geri fırlatılır: kullanıcı sebebini alanın
      // altında görsün, toast'la beraber kaybolmasın.
      toast({ title: e?.message || "Fotoğraf kaydedilemedi", variant: "destructive" })
      throw e
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
          <h1 className="text-3xl font-bold">Menü &amp; Reçeteler</h1>
          <p className="text-muted-foreground">
            Menüyü buradan kurun: ürün ve reçetesi birlikte oluşur. Satışta mamül yerine
            hammaddeleri stoktan düşer; yarı mamüller hammaddeye kadar açılır.
          </p>
        </div>
        {/* Birincil eylem sekmeye göre değişir: menü sekmesinde menü ürünü,
            hammadde sekmesinde hammadde eklemek istenir. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/stok?company=${companyId}`}>
              <PackageSearch className="mr-2 h-4 w-4" />
              Stok
            </Link>
          </Button>
          {/* Kategori yönetimi Stok ekranıyla ORTAK bileşen: menüyü kuran kişi
              kategoriyi de burada düzenleyebilsin diye ikinci bir giriş noktası
              (components/stok/category-manager-dialog). */}
          <Button variant="outline" onClick={() => setCategoryDialogOpen(true)}>
            <Tags className="mr-2 h-4 w-4" />
            Kategoriler
          </Button>
          {tab === "menu" ? (
            <>
              <Button variant="outline" onClick={() => openRawDialogFor(null)}>
                <Plus className="mr-2 h-4 w-4" />
                Yeni Hammadde
              </Button>
              <Button onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" />
                Yeni Menü Ürünü
              </Button>
            </>
          ) : (
            <Button onClick={() => openRawDialogFor(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Hammadde
            </Button>
          )}
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
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {/* Kategori süzgeci — satış ekranındaki kategori sekmelerinin
              menü kurulum tarafındaki karşılığı. */}
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>Tüm kategoriler</SelectItem>
              {filterCategories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
              <SelectItem value={NO_CATEGORY}>Kategorisiz</SelectItem>
            </SelectContent>
          </Select>
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
                : "Hammadde, reçetelerde bileşen olarak kullanılan üründür (süt, kahve çekirdeği). \"Yeni Hammadde\" ile ekleyin."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : tab === "menu" ? (
        <MenuTable
          products={filtered}
          recipeByProduct={recipeByProduct}
          costOf={(id) => costOf(id, recipeMap)}
          optionCountOf={(id) => groupsOf(id).length}
          onEdit={openForProduct}
          onImage={(p) => setImageFor({ id: p.id, name: p.name })}
          // basePrice KDV DAHİL: seçenek fiyat farkları da öyle giriliyor,
          // diyalog ikisini toplayıp satıştaki nihai fiyatı gösteriyor.
          onOptions={(p) =>
            setOptionsFor({ id: p.id, name: p.name, basePrice: grossPrice(p) })
          }
          onDelete={handleDelete}
          onChangeKind={changeKind}
        />
      ) : (
        <RawTable
          products={filtered}
          usedIn={usedInByComponent}
          // Yarı mamülde alış fiyatı değil, kendi reçetesinin açılmış maliyeti geçerli.
          unitCostOf={(id) => resolvedUnitCost(id, recipeMap)}
          hasRecipe={(id) => recipeByProduct.has(id)}
          onEdit={openForProduct}
          onChangeKind={changeKind}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRecipeId
                ? "Reçete Düzenle"
                : draft.mode === "new"
                  ? "Yeni Menü Ürünü"
                  : "Mevcut Ürüne Reçete"}
              {draftProduct ? ` — ${draftProduct.name}` : ""}
            </DialogTitle>
            <DialogDescription>
              {draft.mode === "new"
                ? "Menüde görünecek ürünü ve hangi hammaddelerden hazırlandığını tanımlayın. Ürün kartı otomatik oluşur — Stok ekranına gitmenize gerek yok."
                : "Bir mamülün hangi bileşenlerden oluştuğunu tanımlayın. Bileşenin kendi reçetesi varsa satışta o da açılır (yarı mamül)."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* NOT: Eskiden burada "Yeni ürün oluştur / Mevcut üründen seç" diye
                iki mod düğmesi vardı. Kaldırıldı çünkü ikinci mod, tablodaki
                satırın "Reçete" düğmesiyle AYNI işi yapıyordu — kullanıcı ürünü
                zaten listede görüyorken bir de diyalog içinden aramak zorundaydı.
                Diyalog artık tek bir işi yapar; mevcut ürüne reçete satırdan
                eklenir. `mode` alanı içeride korunuyor (openForProduct onu
                "existing" yapıyor), yalnızca SEÇİM arayüzü kalktı. */}
            {draft.mode === "new" && !editingRecipeId ? (
              <div className="space-y-4 rounded-xl border border-border p-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="np-name">Ürün Adı</Label>
                    <Input
                      id="np-name"
                      value={draft.newProduct.name}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          newProduct: { ...d.newProduct, name: e.target.value },
                        }))
                      }
                      placeholder="Latte, Americano, Cheesecake…"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="np-category">Kategori</Label>
                    {/* Var olan kategoriler öneri olarak sunulur; kategori yine
                        serbest metin (PLAN.md "Adım 2": FK bağı yok). Native
                        <datalist> idi — listeyi ancak yazınca açtığı için
                        kullanıcı mevcut kategorileri hiç göremiyordu. */}
                    <TextCombobox
                      id="np-category"
                      value={draft.newProduct.category}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          newProduct: { ...d.newProduct, category: v },
                        }))
                      }
                      options={menuCategories}
                      placeholder="Sıcak İçecek, Tatlı…"
                      emptyText="Kayıtlı kategori yok — yazdığınız yeni kategori olur"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="np-price">Satış Fiyatı (KDV dahil)</Label>
                    <Input
                      id="np-price"
                      value={draft.newProduct.salePrice}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          newProduct: { ...d.newProduct, salePrice: e.target.value },
                        }))
                      }
                      inputMode="decimal"
                      placeholder="0,00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="np-vat">KDV %</Label>
                    <Input
                      id="np-vat"
                      value={draft.newProduct.vatRate}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          newProduct: { ...d.newProduct, vatRate: e.target.value },
                        }))
                      }
                      inputMode="decimal"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="np-unit">Birim</Label>
                    <Select
                      value={draft.newProduct.unit}
                      onValueChange={(v) =>
                        setDraft((d) => ({ ...d, newProduct: { ...d.newProduct, unit: v } }))
                      }
                    >
                      <SelectTrigger id="np-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Fotoğraf ürün kartıyla BİRLİKTE doğar: satış ekranını
                    fotoğraflı kurmak için sonradan ikinci bir tura gerek yok. */}
                <div className="space-y-2 border-t border-border pt-3">
                  <Label>Fotoğraf</Label>
                  <ProductImageField
                    companyId={companyId}
                    value={draft.newProduct.imageUrl}
                    onChange={(url) =>
                      setDraft((d) => ({ ...d, newProduct: { ...d.newProduct, imageUrl: url } }))
                    }
                  />
                </div>

                {/* NOT: Eskiden burada "Girilen fiyat KDV dahil" anahtarı vardı.
                    Kaldırıldı: kafede menü fiyatı DAİMA brüttür, anahtarın
                    varsayılanı zaten açıktı ve kapatılması pratikte hiç
                    gerekmiyordu. Fiyat alanının etiketi bunu açıkça yazıyor;
                    net girmek isteyen Stok ekranından düzenleyebilir. */}

                <div className="flex items-start gap-2 border-t border-border pt-3">
                  <Switch
                    id="np-has-recipe"
                    checked={draft.hasRecipe}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, hasRecipe: v }))}
                  />
                  <div>
                    <Label htmlFor="np-has-recipe" className="text-sm font-normal">
                      Bu ürün hammaddelerden hazırlanıyor
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {draft.hasRecipe
                        ? "Satışta hammaddeleri stoktan düşer; ürünün kendi stoğu tutulmaz."
                        : "Kapalı: şişe su, kutu kola gibi hazır ürünler. Satışta ürünün kendisi stoktan düşer."}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="space-y-2">
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
              </div>
            )}

            {draft.productId && recipeByProduct.has(draft.productId) && !editingRecipeId && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Bu ürünün zaten bir reçetesi var. Kaydederseniz mevcut reçetenin bileşenleri
                  tamamen bunlarla değiştirilir.
                </span>
              </div>
            )}

            {/* Reçete bölümü: yeni üründe anahtar kapalıysa hiç gösterilmez —
                şişe su eklerken bileşen tablosu görmek kafa karıştırıcı. */}
            {recipeRequired && (
            <>
            <div className="space-y-2">
              {/* Üretim miktarı TEK yerde: reçetenin hemen üstünde. Eskiden mod'a
                  göre iki ayrı alan render ediliyordu ("kaç adet mamül" / "kaç
                  adet ürün") — aynı alanın iki kopyası, iki farklı metinle.
                  Reçetesi olmayan üründe zaten anlamsız, o yüzden burada. */}
              <div className="w-full sm:w-64">
                <Label htmlFor="yieldQuantity">
                  Üretim Miktarı{draftUnit ? ` (${unitShortLabel(draftUnit)})` : ""}
                </Label>
                <Input
                  id="yieldQuantity"
                  className="mt-1.5"
                  value={draft.yieldQuantity}
                  onChange={(e) => setDraft((d) => ({ ...d, yieldQuantity: e.target.value }))}
                  inputMode="decimal"
                  placeholder="1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Aşağıdaki bileşenler bu kadar ürün üretir. Porsiyon başına düşen
                  miktar her satırda ayrıca yazıyor.
                </p>
              </div>
              <div className="flex items-center justify-between">
                <Label>Bileşenler</Label>
                {/* "Yeni Hammadde" artık her bileşen satırının kendi + düğmesinde:
                    oradan açılınca oluşan kart satıra yazılıyor, buradan açılınca
                    yazılmıyordu — aynı işi yapan iki düğmeden yalnız biri işe
                    yarıyordu. Bağlamsız oluşturma sayfa başlığında duruyor. */}
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
                  const unitOptions = component ? recipeUnitOptions(component.unit, item.unit) : []
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
                  const yieldForPreview = num(draft.yieldQuantity) > 0 ? num(draft.yieldQuantity) : 1
                  /**
                   * Kalem miktarı PARTİ içindir (reçete `yieldQuantity` adet
                   * üretir); tek porsiyona düşen pay buna bölünerek bulunur —
                   * genişletmedeki `item.quantity / yieldQty` ile aynı hesap.
                   */
                  const perPortionQty =
                    convertedQty != null ? convertedQty / yieldForPreview : null
                  // Satır maliyeti de PORSİYON başınadır: yanındaki "stoktan
                  // düşecek" rakamıyla ve sağdaki özetin "birim maliyet"iyle aynı
                  // tabanda olmalı. Parti düzeyinde bırakılınca 10 porsiyonluk
                  // reçetede satırlar toplamı özetin 10 katını gösteriyordu.
                  const lineCost =
                    unitCost != null && perPortionQty != null ? perPortionQty * unitCost : null
                  /**
                   * Birim hatası alarmı: TEK porsiyon eldeki stoğun tamamını
                   * aşıyorsa büyük ihtimalle birim yanlış seçilmiş (200 ML yerine
                   * 200 LT). Yarı mamülde stok tutulmadığı için kontrol edilmez.
                   */
                  const overStock =
                    !isSemiFinished &&
                    perPortionQty != null &&
                    perPortionQty > Number(component?.stockQuantity ?? 0)

                  return (
                    <div
                      key={item.key}
                      className="grid grid-cols-1 gap-2 rounded-lg border border-kobipo-border p-3 sm:grid-cols-12 sm:items-end"
                    >
                      <div className="space-y-1.5 sm:col-span-5">
                        <Label className="text-xs text-muted-foreground">Bileşen</Label>
                        <div className="flex gap-1.5">
                          <div className="min-w-0 flex-1">
                            <SearchSelect
                              options={componentOptions}
                              value={item.componentProductId}
                              onChange={(id) => selectComponent(item.key, id)}
                              placeholder="Ürün seçin"
                              emptyText="Ürün bulunamadı"
                            />
                          </div>
                          {/* Aradığı hammadde henüz yoksa reçeteyi bölmeden BU
                              satırdan oluşturabilsin; oluşan kart doğrudan satıra
                              yazılır (handleRawCreated). Eskiden diyalog yalnızca
                              başlıktan açılıyordu ve hedef satır hiç verilmediği
                              için kullanıcı hammaddeyi listeden tekrar aramak
                              zorunda kalıyordu. */}
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="shrink-0"
                            onClick={() => openRawDialogFor(item.key)}
                            title="Yeni hammadde oluştur ve bu satıra yaz"
                            aria-label="Yeni hammadde oluştur"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
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
                                {unitShortLabel(u)}
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
                        <div className="space-y-1 sm:col-span-12">
                          {/* Dönüşümü AÇIKÇA göster. Birim yanlış seçildiğinde
                              hata buradan görülür: "200 LT → 200 LT düşer" ile
                              "200 ML → 0,2 LT düşer" arasındaki fark gözle
                              yakalanabilir olmalı. */}
                          {perPortionQty != null && (
                            <p className="text-xs font-medium">
                              <span className="text-muted-foreground">Stoktan düşecek: </span>
                              <span
                                className={cn(
                                  "tabular-nums",
                                  overStock ? "text-red-600 dark:text-red-400" : "text-foreground"
                                )}
                              >
                                {qty(perPortionQty)} {unitShortLabel(component.unit)}
                              </span>
                              <span className="text-muted-foreground"> / porsiyon</span>
                              {/* Parti miktarı ayrı yazılır. Eskiden buraya parti
                                  toplamı basılıp "/ porsiyon" deniyordu: 10
                                  porsiyonluk reçetede kullanıcı 10 katını görüp
                                  birimi yanlış girdiğini sanıyordu. */}
                              {yieldForPreview > 1 && convertedQty != null && (
                                <span className="text-muted-foreground">
                                  {" · "}
                                  <span className="tabular-nums">
                                    {qty(convertedQty)} {unitShortLabel(component.unit)}
                                  </span>{" "}
                                  toplam ({qty(yieldForPreview)} porsiyonluk reçete)
                                </span>
                              )}
                            </p>
                          )}
                          {/* Birim hatasının en tipik belirtisi: tek porsiyon
                              eldeki tüm stoğu aşıyor. Engellemiyoruz (stok
                              gerçekten bitmiş olabilir) ama sessiz de geçmiyoruz. */}
                          {overStock && (
                            <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>
                                Tek porsiyon için eldeki stoktan ({qty(component.stockQuantity ?? 0)}{" "}
                                {unitShortLabel(component.unit)}) fazlası gerekiyor. Birimi kontrol
                                edin — {unitShortLabel(item.unit)} yerine{" "}
                                <button
                                  type="button"
                                  className="font-semibold underline underline-offset-2"
                                  onClick={() =>
                                    patchItem(item.key, { unit: defaultRecipeUnit(component.unit) })
                                  }
                                >
                                  {unitShortLabel(defaultRecipeUnit(component.unit))}
                                </button>{" "}
                                mi olmalıydı?
                              </span>
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Stok birimi <strong>{unitShortLabel(component.unit)}</strong>
                            {!isSemiFinished && ` · Stok ${qty(component.stockQuantity ?? 0)}`}
                            {unitCost != null
                              ? ` · Birim maliyet ${money(unitCost)}/${unitShortLabel(component.unit)}`
                              : " · Alış fiyatı girilmemiş"}
                            {lineCost != null ? ` · Porsiyon maliyeti ${money(lineCost)}` : ""}
                            {isSemiFinished ? " · Yarı mamül (hammaddeye kadar açılacak)" : ""}
                          </p>
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
                {/* Yalnızca DÜZENLEMEDE anlamlı: var olan bir reçeteyi geçici
                    olarak devre dışı bırakmak için. Yeni reçete kurarken kimse
                    onu kapalı oluşturmuyor — o yüzden yeni üründe hiç sorulmaz
                    (emptyDraft zaten true veriyor). */}
                {editingRecipeId && (
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
                )}
              </div>

              <CostSummary
                preview={preview}
                salePrice={draftSalePrice}
                yieldQuantity={num(draft.yieldQuantity) > 0 ? num(draft.yieldQuantity) : 1}
                unit={draftUnit || undefined}
              />
            </div>
            </>
            )}

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
              {saving
                ? "Kaydediliyor…"
                : draft.mode === "new" && !editingRecipeId
                  ? "Menüye Ekle"
                  : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RawMaterialDialog
        open={rawDialogOpen}
        onOpenChange={(open) => {
          setRawDialogOpen(open)
          if (!open) setRawTargetKey(null)
        }}
        companyId={companyId}
        onCreated={handleRawCreated}
      />

      <ProductOptionsDialog
        open={!!optionsFor}
        companyId={companyId}
        product={optionsFor}
        groups={optionsFor ? groupsOf(optionsFor.id) : []}
        // Reçete etkisi için ürün listesi: hammadde de seçilebilmeli (asıl iş
        // "sütün yerine soya sütü"), o yüzden menü filtresi UYGULANMAZ.
        products={effectProducts}
        recipeComponentIds={
          optionsFor
            ? (recipeByProduct.get(optionsFor.id)?.items ?? []).map((i) => i.componentProductId)
            : []
        }
        onClose={() => setOptionsFor(null)}
        onSaved={() => void mutateOptions()}
      />

      <CategoryManagerDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        companyId={companyId}
        onChanged={() => {
          // Silme/birleştirme ürünlerin `category` alanını değiştiriyor; hem ürün
          // listesi hem öneri listesi tazelenmeli. Süzgeçte artık var olmayan bir
          // kategori seçiliyse "tümü"ne düşülür, yoksa liste boş görünürdü.
          void refresh()
          void mutateCategories()
          setCategoryFilter(ALL_CATEGORIES)
        }}
      />

      {/* Fotoğraf — satırdaki küçük görselden açılır. Ayrı diyalog olmasının
          sebebi: reçete diyaloğu mevcut üründe yalnızca REÇETEYİ düzenliyor,
          oraya bir ürün alanı koymak o diyaloğun tek işi olma kuralını bozardı. */}
      <Dialog open={!!imageFor} onOpenChange={(open) => !open && setImageFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ürün Fotoğrafı{imageFor ? ` — ${imageFor.name}` : ""}</DialogTitle>
            <DialogDescription>
              Menü kartında görünecek fotoğrafı seçin.
            </DialogDescription>
          </DialogHeader>
          {imageFor && (
            <ProductImageField
              companyId={companyId}
              value={productById.get(imageFor.id)?.imageUrl ?? null}
              onChange={(url) => saveProductImage(imageFor.id, url)}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImageFor(null)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Satır içi tür değiştirici. Menü ve hammadde sekmelerinin ikisi de bunu
 * kullanır — eskiden her satırda iki ayrı anahtar vardı ve "ikisi de kapalı"
 * durumunda ürün hiçbir sekmede görünmüyordu.
 */
function KindSelect({
  product,
  onChange,
}: {
  product: Product
  onChange: (p: Product, kind: ProductKind) => void
}) {
  const kind = productKindOf(product)
  return (
    <Select value={kind} onValueChange={(v) => onChange(product, v as ProductKind)}>
      {/* SelectValue'ya AÇIKÇA etiket veriliyor: Radix varsayılan olarak seçili
          SelectItem'ın tüm içeriğini tetikleyicide de basıyor. Şıklara açıklama
          eklenince her satırdaki kutu iki satıra çıkıp tabloyu sıkıştırdı.
          Açıklama yalnız açılır listede görünmeli. */}
      <SelectTrigger className="h-8 w-[130px] text-xs">
        <SelectValue>{productKindLabel(kind, true)}</SelectValue>
      </SelectTrigger>
      {/* Açıklamalar seçenek TANIMINDA zaten vardı (productKindOptions.hint) ama
          burada basılmıyordu; "Hammadde" ile "Her ikisi" arasındaki fark yalnız
          etiketten anlaşılmıyordu. Tetikleyicide yine sadece etiket var — tablo
          hücresi dar. */}
      <SelectContent className="max-w-[280px]">
        {MENU_KIND_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            <span className="flex flex-col gap-0.5 py-0.5">
              <span className="font-medium">{o.label}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{o.hint}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Bu ekran yalnızca Restoran & Kafe açıkken erişilebilir olduğundan seçenekler
 * daima menü dilinde. "Hizmet" burada YOK: hizmetin menüsü/reçetesi olmaz ve
 * bu ekran zaten hizmetleri listelemiyor — Stok ekranından yönetilir.
 */
const MENU_KIND_OPTIONS = productKindOptions(true).filter((o) => o.value !== "service")

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
      <Row
        label={`Birim maliyet${unit ? ` (1 ${unitShortLabel(unit)})` : ""}`}
        value={money(cost)}
        strong
      />
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
  optionCountOf,
  onEdit,
  onImage,
  onOptions,
  onDelete,
  onChangeKind,
}: {
  products: Product[]
  recipeByProduct: Map<string, Recipe>
  costOf: (productId: string) => { total: number; priceless: string[]; hasRecipe: boolean }
  optionCountOf: (productId: string) => number
  onEdit: (p: Product) => void
  onImage: (p: Product) => void
  onOptions: (p: Product) => void
  onDelete: (r: Recipe) => void
  onChangeKind: (p: Product, kind: ProductKind) => void
}) {
  return (
    <StyledTableContainer>
      <Table>
        <TableHeader>
          <StyledTableHeaderRow>
            {/* Fotoğraf sütunu başlıksız: 40px'lik hücreye "Fotoğraf" yazısı
                sığmıyor, küçük görselin kendisi zaten ne olduğunu söylüyor. */}
            <StyledTableHead className="w-[52px]" />
            <StyledTableHead>Ürün</StyledTableHead>
            <StyledTableHead>Reçete</StyledTableHead>
            {/* Maliyet ve Marj dar ekranda gizlenir: yedi sütun 1280px altında
                sıkışıyor. Satış fiyatı kalır — kasada asıl bakılan o; maliyet/marj
                menü kurgulanırken bakılan, geniş ekranda çalışılan bilgi. */}
            <StyledTableHead className="hidden text-right xl:table-cell">Maliyet</StyledTableHead>
            <StyledTableHead className="text-right">Satış</StyledTableHead>
            <StyledTableHead className="hidden text-right xl:table-cell">Marj</StyledTableHead>
            {/* Tür KENDİ sütununda: "İşlem" içindeki başlıksız açılır menü
                bulunamıyordu — ürünü satış ekranından gizlemenin yolu bu. */}
            <StyledTableHead>Tür</StyledTableHead>
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
                  {/* Fotoğrafsız ürün kesikli çerçeve + kamera ikonuyla durur:
                      tıklanabilir olduğu, boş bir hücreden anlaşılmazdı. */}
                  <button
                    type="button"
                    onClick={() => onImage(p)}
                    title={p.imageUrl ? `${p.name} — fotoğrafı değiştir` : `${p.name} — fotoğraf ekle`}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border transition-colors",
                      p.imageUrl
                        ? "border-border hover:border-kobipo-blue dark:hover:border-primary"
                        : "border-dashed border-border text-muted-foreground hover:border-kobipo-blue hover:text-kobipo-blue dark:hover:border-primary dark:hover:text-primary"
                    )}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- depo URL'i
                      <img src={p.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <ImagePlus className="h-4 w-4" />
                    )}
                  </button>
                </TableCell>
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
                    {!recipe && ` · Stok ${qty(p.stockQuantity ?? 0)}`}
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
                <TableCell className="hidden text-right tabular-nums xl:table-cell">
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
                <TableCell className="hidden text-right tabular-nums xl:table-cell">
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
                  {/* Tür değişimi TEK seçim — iki ayrı anahtar 4 kombinasyon
                      üretiyordu ve ikisi de kapalıyken ürün hiçbir sekmede
                      görünmüyordu. Bkz. lib/stock/product-kind.ts */}
                  <KindSelect product={p} onChange={onChangeKind} />
                </TableCell>
                <TableCell>
                  {/* whitespace-nowrap: yedi sütunlu tabloda eylemler alt alta
                      sarıp satırı iki katına çıkarıyordu. Düğme yükseklikleri de
                      eşitlendi (h-8) — karışık boylar sıkışık gösteriyordu. */}
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
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
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => onDelete(recipe)}
                        title="Reçeteyi sil"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                    {/* Seçenek (boy/süt/ekstra) — sayısı rozette, tanımı diyalogda. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => onOptions(p)}
                      title="Porsiyon / seçenek tanımla"
                    >
                      Seçenek
                      {optionCountOf(p.id) > 0 && (
                        <span className="ml-1 rounded-full bg-kobipo-blue px-1.5 text-[10px] font-bold text-white dark:bg-primary dark:text-primary-foreground">
                          {optionCountOf(p.id)}
                        </span>
                      )}
                    </Button>
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
  onChangeKind,
}: {
  products: Product[]
  usedIn: Map<string, string[]>
  unitCostOf: (productId: string) => number | null
  hasRecipe: (productId: string) => boolean
  onEdit: (p: Product) => void
  onChangeKind: (p: Product, kind: ProductKind) => void
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
            <StyledTableHead className="text-right">Tür</StyledTableHead>
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{p.name}</span>
                    {isSemiFinished && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-kobipo-pale px-2 py-0.5 text-[11px] font-semibold text-kobipo-blue">
                        <Layers className="h-3 w-3" />
                        Yarı mamül
                      </span>
                    )}
                    {/* Hammadde sekmesinde "Her ikisi" olan ürünler de listeleniyor
                        (paket kahve hem satılır hem reçetede geçer). Hangisinin
                        satış/adisyon ızgarasına DÜŞMEDİĞİ ancak sağdaki tür
                        seçicisine bakınca anlaşılıyordu. */}
                    {!p.isSellable ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        <EyeOff className="h-3 w-3" />
                        Menüde görünmez
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <ShoppingCart className="h-3 w-3" />
                        Menüde satılıyor
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
                    qty(p.stockQuantity ?? 0)
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
                    {/* Reçetesi olmayan hammaddeye de reçete kurulabilmeli:
                        Espresso gibi yarı mamüller böyle doğuyor. Eskiden bu yol
                        yalnızca diyalogdaki "Mevcut üründen seç" modundaydı;
                        o mod kalkınca eylem satıra taşındı — ürünü listede
                        görürken tıklamak, diyalog içinde aramaktan kolay. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(p)}
                      title={isSemiFinished ? "Reçeteyi düzenle" : "Reçete ekle"}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <KindSelect product={p} onChange={onChangeKind} />
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
