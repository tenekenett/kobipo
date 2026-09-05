"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { ArrowLeft, Package, TrendingUp, TrendingDown, BarChart3, Pencil, ArrowDownToLine, ArrowUpFromLine } from "lucide-react"
import Link from "next/link"
import { looksLikeCuid } from "@/lib/slug"
import { formatMoney } from "@/lib/format"
import { ProductEditDialog } from "@/components/stok/product-edit-dialog"
import {
  StockMovementDialog,
  type StockMovementMode,
} from "@/components/stok/stock-movement-dialog"
import { useRecipes } from "@/lib/swr/use-company-data"
import { WriteAction } from "@/components/dashboard/write-guard"

interface StockMovement {
  id: string
  date: string
  type: "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER"
  quantity: number
  unitPrice: number
  totalAmount: number
  description: string
  referenceNo?: string
  /**
   * Hareketin kaynağı faturaysa belgenin kimliği (uç doldurur). `no` e-Belge
   * numarasıdır, yoksa iç fatura numarası. Yoksa (irsaliye, adisyon, elle fiş)
   * null gelir ve referans ham haliyle basılır.
   */
  invoice?: { id: string; no: string; type: string } | null
  /** İrsaliye kaynaklı hareket: numara + hangi listede aranacağı (SALES/PURCHASE). */
  waybill?: { id: string; no: string; type: string } | null
  balanceAfter: number
  /** Hareketin KAYNAK BELGE para birimi — ürününkinden farklı olabilir (bkz. API). */
  currency?: string | null
}

interface ProductDetail {
  id: string
  slug?: string
  code?: string
  name: string
  barcode?: string
  category?: string | null
  /** Depodaki fiziksel yer (raf/koridor/göz) — serbest metin. */
  shelfCode?: string | null
  unit: string
  vatRate: number
  purchasePrice?: number
  salePrice?: number
  currency?: string | null
  purchasePriceVatIncluded?: boolean | null
  salePriceVatIncluded?: boolean | null
  stockQuantity: number
  minStockLevel?: number
  isService: boolean
  isActive: boolean
  totalIn: number
  totalOut: number
  movements: StockMovement[]
  /**
   * BELGELERDEN türeyen fiyatlar — kartın elle girilen alanlarının yanında
   * "gerçek" olarak durur, karta OTOMATİK yazılmaz (bkz. lib/stock/sale-price.ts).
   * Tanımları uç değil ortak modüller verir: cost.ts (AVCO) ve sale-price.ts.
   */
  avgPurchasePrice?: number | null
  lastPurchase?: { unitPrice: number; date: string } | null
  avgSalePrice?: {
    price: number
    quantity: number
    /** PERIOD = pencere içi, ALL = tüm zamanlar (pencere boş kaldı). */
    scope: "PERIOD" | "ALL"
    periodDays: number
    lastSaleDate: string | null
  } | null
}

/**
 * Hareketin YÖNÜ tek kaynaktan okunur: işaretli miktar (+ giriş, − çıkış).
 * Uç artık işaretli döndürüyor; öncesinde mutlak değer geliyordu ve ekrandaki
 * "miktar > 0 ise giriş" kuralı satışlar dahil HER satırı yeşil "Giriş" yapıyordu.
 */
function movementTone(quantity: number): "in" | "out" | "flat" {
  return quantity > 0 ? "in" : quantity < 0 ? "out" : "flat"
}

/**
 * Referans hücresinin metni: fatura değilse ne yazacağımız. `waybill:<id>`
 * (irsaliye) ve çıplak cuid (adisyon vb.) kullanıcıya bir şey anlatmaz.
 */
/**
 * İrsaliyenin ayrı bir detay sayfası yok; liste sayfası `?ara=` ile numarayla
 * süzülü açılır, kullanıcı belgeyi tek tıkla bulur.
 */
function waybillHref(waybill: { no: string; type: string }, companyId: string | null): string {
  const base = waybill.type === "PURCHASE" ? "/alis/irsaliye" : "/satis/irsaliye"
  return `${base}?company=${encodeURIComponent(companyId ?? "")}&ara=${encodeURIComponent(waybill.no)}`
}

function referenceLabel(referenceNo?: string): string {
  if (!referenceNo) return "-"
  // Buraya yalnız SİLİNMİŞ/bulunamayan irsaliye düşer: çözülebilenler numarasıyla
  // ve bağlantılı basılır (bkz. waybillHref).
  if (referenceNo.startsWith("waybill:")) return "İrsaliye"
  return looksLikeCuid(referenceNo) ? "-" : referenceNo
}

/** Etiket: tipi bilinen özel hareketler kendi adıyla, kalanlar yönüyle anılır. */
function movementLabel(movement: StockMovement): string {
  if (movement.type === "TRANSFER") return "Transfer"
  if (movement.type === "ADJUSTMENT") return "Düzeltme"
  const tone = movementTone(movement.quantity)
  return tone === "in" ? "Giriş" : tone === "out" ? "Çıkış" : "—"
}

const TONE_BADGE: Record<"in" | "out" | "flat", string> = {
  in: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  out: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  flat: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
}

const TONE_TEXT: Record<"in" | "out" | "flat", string> = {
  in: "text-green-600",
  out: "text-red-600",
  flat: "",
}

export default function ProductDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  
  const id = params.id as string
  const companyId = searchParams.get("company")
  
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [whStocks, setWhStocks] = useState<Array<{ warehouseName: string; quantity: number; unit: string }>>([])
  const [movementOpen, setMovementOpen] = useState(false)
  const [movementMode, setMovementMode] = useState<StockMovementMode>("IN")
  /** Hangi türetilmiş fiyat karta yazılıyor — düğme iki kez basılmasın diye. */
  const [applying, setApplying] = useState<"purchase" | "sale" | null>(null)

  // Reçeteli ürünün KENDİ bakiyesi tutulmaz (satışta bileşenleri düşer), bu yüzden
  // elle giriş/çıkış anlamsızdır — liste ekranı da o ürünlerde stok yerine "—" basar.
  const { recipeMap } = useRecipes(companyId)
  const hasRecipe = product ? recipeMap.has(product.id) : false
  const canMoveStock = Boolean(product && !product.isService && !hasRecipe)

  const openMovement = (mode: StockMovementMode) => {
    setMovementMode(mode)
    setMovementOpen(true)
  }

  useEffect(() => {
    if (id && companyId) {
      fetchProduct()
    }
  }, [id, companyId])

  // Depo dökümü ÜRÜNÜN ID'siyle sorulur, adres çubuğundaki slug ile değil:
  // /api/depolar/stok slug çözmez, "zztest-stok-denemesi" hiçbir satıra uymaz ve
  // kart her ürün için "henüz depo bazlı dağılım yok" diyordu (SEF adreslere
  // geçildiğinden beri).
  const productId = product?.id
  const fetchWarehouseStocks = useCallback(() => {
    if (!productId || !companyId) return
    fetch(`/api/depolar/stok?companyId=${companyId}&productId=${productId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.stocks) {
          setWhStocks(d.stocks.map((s: any) => ({ warehouseName: s.warehouseName, quantity: s.quantity, unit: s.unit })))
        }
      })
      .catch(() => {})
  }, [productId, companyId])

  useEffect(() => {
    fetchWarehouseStocks()
  }, [fetchWarehouseStocks])

  const fetchProduct = async () => {
    try {
      const response = await fetch(`/api/stok/products/${id}?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setProduct(data)
        // SEF: eski cuid URL ile gelindiyse okunabilir slug URL'ine sessizce yükselt.
        if (data?.slug && looksLikeCuid(String(id))) {
          router.replace(`/stok/${data.slug}?company=${companyId}`)
        }
      } else {
        toast({
          title: "Hata",
          description: "Ürün bulunamadı",
          variant: "destructive",
        })
        router.push(`/stok?company=${companyId}`)
      }
    } catch (error) {
      console.error("Error fetching product:", error)
      toast({
        title: "Hata",
        description: "Ürün yüklenemedi",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Türetilmiş fiyatı KARTA yazar — kullanıcının açık eylemi.
   *
   * Gövdeye YALNIZ o fiyat konur; uç gövdede olmayan alana dokunmuyor
   * (app/api/stok/products/[id] PUT). Öteki fiyatı da göndermek, kullanıcı
   * bu sırada başka bir sekmede fiyatı değiştirdiyse onun yazdığını geri alırdı.
   *
   * `...VatIncluded: false` bilinçli: ortak modüllerin verdiği sayı NET'tir
   * (KDV hariç) ve DB de net saklar. Bayrak "kullanıcı KDV dahil girdi mi"
   * sorusunu hatırlar; true kalsaydı form aynı sayıyı KDV ile şişirip gösterirdi.
   */
  const applyDerivedPrice = async (field: "purchase" | "sale", value: number) => {
    if (!companyId || !product) return
    setApplying(field)
    try {
      const body =
        field === "purchase"
          ? { companyId, purchasePrice: String(value), purchasePriceVatIncluded: false }
          : { companyId, salePrice: String(value), salePriceVatIncluded: false }
      const response = await fetch(`/api/stok/products/${product.id}?companyId=${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || "Fiyat güncellenemedi")
      }
      await fetchProduct()
      toast({
        title: "Fiyat güncellendi",
        description:
          field === "purchase"
            ? "Alış fiyatı ortalama maliyete çekildi."
            : "Satış fiyatı gerçekleşen ortalamaya çekildi.",
      })
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "Fiyat güncellenemedi",
        variant: "destructive",
      })
    } finally {
      setApplying(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Ürün bulunamadı</p>
      </div>
    )
  }

  // Kart üzerindeki tutarlar ürünün KENDİ para birimindedir: fiyat alanı $ olarak
  // girilmişse ₺ ile basmak kullanıcıya "100 dolarlık malı 100 liraya" sattırır.
  const formatCurrency = (amount: number, currency: string | null = product.currency ?? null) =>
    formatMoney(amount, currency)

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num)
  }

  const formatDay = (iso: string) => new Date(iso).toLocaleDateString("tr-TR")

  /**
   * Yüzde — Türkçe biçimde: işaret ÖNDE, `%` sayının solunda, ondalık ayırıcı
   * virgül. `%{rate.toFixed(1)}` "%-80.0" üretiyordu: hem eksi yanlış yerde hem
   * ayırıcı nokta.
   */
  const formatRate = (rate: number) => {
    const sign = rate < 0 ? "-" : ""
    const value = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(Math.abs(rate))
    return `${sign}%${value}`
  }

  /**
   * Fiyat karşılaştırma/yazma hassasiyeti: 4 ondalık.
   *
   * Kuruşa yuvarlamak hammaddeyi bozardı — gram başına ₺0,0234 duran kahve
   * çekirdeği ₺0,02'ye inince reçete maliyeti %15 kayar. Ham bölme sonucunu
   * olduğu gibi bırakmak ise ters uçta sorunlu: 42.499999999 ile 42,5 asla eşit
   * çıkmaz ve düğme fiyat güncellendikten SONRA da ekranda durmaya devam eder.
   */
  const roundPrice = (value: number) => Math.round(value * 10000) / 10000
  const samePrice = (a: number, b: number | null) => b != null && roundPrice(a) === roundPrice(b)

  const avgCost = product.avgPurchasePrice ?? null
  const cardPurchase = product.purchasePrice != null ? Number(product.purchasePrice) : null
  const cardSale = product.salePrice != null ? Number(product.salePrice) : null
  const derivedSale = product.avgSalePrice ?? null

  /**
   * Stok değeri ve marj ORTALAMA MALİYETTEN hesaplanır; o yoksa kartın alış
   * fiyatına düşer. Eskiden ikisi de yalnız karta bakıyordu: alış faturaları
   * ortalamayı ₺42'ye taşımışken kartta ₺30 duruyorsa depo değeri olduğundan
   * düşük, marj olduğundan yüksek görünüyordu — üstelik /stok listesi aynı ürün
   * için AVCO basıyordu, yani liste ile kart birbirini tutmuyordu.
   */
  const unitCost = avgCost ?? cardPurchase
  const marginBase = unitCost != null && unitCost > 0 ? unitCost : null
  const margin =
    marginBase != null && cardSale != null
      ? { profit: cardSale - marginBase, rate: ((cardSale - marginBase) / marginBase) * 100 }
      : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/stok?company=${companyId}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{product.name}</h1>
            <p className="text-muted-foreground">
              {product.isService ? "Hizmet" : "Ürün"} 
              {product.code && ` | Kod: ${product.code}`}
              {product.barcode && ` | Barkod: ${product.barcode}`}
              {product.shelfCode && ` | Raf: ${product.shelfCode}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canMoveStock && (
            <>
              <WriteAction>
                <Button variant="outline" size="sm" onClick={() => openMovement("IN")}>
                  <ArrowDownToLine className="h-4 w-4 mr-2 text-green-600" />
                  Stok Girişi
                </Button>
              </WriteAction>
              <WriteAction>
                <Button variant="outline" size="sm" onClick={() => openMovement("OUT")}>
                  <ArrowUpFromLine className="h-4 w-4 mr-2 text-red-600" />
                  Stok Çıkışı
                </Button>
              </WriteAction>
            </>
          )}
          <WriteAction>
            <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              Düzenle
            </Button>
          </WriteAction>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            product.isActive ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
          }`}>
            {product.isActive ? "Aktif" : "Pasif"}
          </span>
        </div>
      </div>

      {/* Depo Dağılımı */}
      {!product.isService && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" /> Depo Dağılımı
            </CardTitle>
          </CardHeader>
          <CardContent>
            {whStocks.filter((s) => s.quantity !== 0).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Henüz depo bazlı dağılım yok — toplam {formatNumber(product.stockQuantity)} {product.unit}. İlk depo işleminde Ana Depo'ya atanır.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {whStocks
                  .filter((s) => s.quantity !== 0)
                  .map((s, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md border p-3">
                      <span className="text-sm">{s.warehouseName}</span>
                      <span className="font-semibold">{formatNumber(s.quantity)} {s.unit}</span>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mevcut Stok</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${
              product.stockQuantity <= (product.minStockLevel || 0) 
                ? "text-red-600" 
                : "text-green-600"
            }`}>
              {formatNumber(Number(product.stockQuantity))} {product.unit}
            </div>
            {product.minStockLevel && (
              <p className="text-xs text-muted-foreground">
                Min: {formatNumber(product.minStockLevel)} {product.unit}
              </p>
            )}
            {canMoveStock && (
              <WriteAction>
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-kobipo-blue underline-offset-2 hover:underline"
                    onClick={() => openMovement("COUNT")}
                  >
                    Sayım / düzeltme
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => openMovement("OPENING")}
                  >
                    Açılış stoğu
                  </button>
                </div>
              </WriteAction>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Toplam Giriş</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatNumber(product.totalIn)} {product.unit}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Toplam Çıkış</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatNumber(product.totalOut)} {product.unit}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stok Değeri</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {unitCost == null ? "—" : formatCurrency(Number(product.stockQuantity) * unitCost)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {unitCost == null
                ? "Maliyet bilinmiyor"
                : avgCost != null
                  ? "Ortalama maliyetten"
                  : "Kart alış fiyatından"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Product Details */}
      {/*
        İki kart YAN YANA DEĞİL, alt alta ve ikisi de tam genişlik.
        Yan yana dizildiklerinde ürün bilgileri kartı (4-6 kısa alan) fiyat kartının
        yanında yarım sayfalık bir boşluk bırakıyordu; kartı içeriğine kısaltmak da
        boşluğu kartın içinden yanına taşımaktan öteye gitmedi. Ürün bilgileri artık
        alanları yatay dizen bir şerit, fiyat kartı ise genişliği gerçekten kullanıyor
        (alış/satış ekseni iki sütun).
      */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Ürün / Hizmet Bilgileri</CardTitle>
          </CardHeader>
          <CardContent>
            {/*
              Izgara DEĞİL, akış: alanların sayısı ürüne göre 3 ile 6 arasında
              değişiyor (barkod, raf, kategori, para birimi koşullu). Sabit sütunlu
              bir ızgarada 5 alan aralarında 200px boşlukla dağılıyor, 3 alan ise
              satırın yarısını boş bırakıyordu. `flex-wrap` alanları sabit aralıkla
              yan yana dizer; sayı kaç olursa olsun şerit aynı sıklıkta görünür.
            */}
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Birim</p>
                <p className="font-medium">{product.unit}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">KDV Oranı</p>
                <p className="font-medium">%{product.vatRate}</p>
              </div>
              {product.barcode && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Barkod</p>
                  <p className="font-medium font-mono">{product.barcode}</p>
                </div>
              )}
              {product.shelfCode && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Raf No</p>
                  <p className="font-medium font-mono">{product.shelfCode}</p>
                </div>
              )}
              {/* Kategori sayfanın HİÇBİR yerinde görünmüyordu — başlık satırı da basmıyor. */}
              {product.category && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Kategori</p>
                  <p className="font-medium">{product.category}</p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-muted-foreground">Tip</p>
                <p className="font-medium">{product.isService ? "Hizmet" : "Ürün"}</p>
              </div>
              {/* Para birimi yalnız TRY DIŞINDA anlamlı: kartın fiyatları o birimdedir. */}
              {product.currency && product.currency !== "TRY" && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Para Birimi</p>
                  <p className="font-medium">{product.currency}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/*
          Kart TEK bir soruyu cevaplıyor: "bu ürünün fiyatı ne?" — ve cevabın iki
          hâli var. Kartta YAZAN fiyat yeni belgelerde kullanılan tahminimiz;
          FATURALARA GÖRE olan ise gerçekte olan biten. Bu yüzden düzen, alış ve
          satış eksenlerini ayrı kutulara alıp her kutuda AYNI iki satırı
          (Kartta yazan / Faturalara göre) tekrarlıyor: kullanıcı iki sayıyı
          karşılaştırmak için etiket okumak zorunda kalmıyor, aynı yerde yan yana
          duruyorlar.

          Önceki düzen bilgiyi taşıyordu ama ilişkiyi göstermiyordu: elle girilen
          fiyatlar üstte bir satır, türetilenler altta ayrı bir kutu, aralarında
          hangi sayının hangisinin karşılığı olduğunu söyleyen bir şey yoktu.

          Türetilen sayı karta kendiliğinden YAZILMAZ — "Fiyatı güncelle" kullanıcının
          açık eylemidir. Gerekçe lib/stock/sale-price.ts başlığında: gerçekleşen
          ortalama liste fiyatının üstüne otomatik yazılsaydı iskontolu her satış
          fiyatı aşağı çeker, sonraki satış daha aşağıdan başlardı.
        */}
        <Card>
          <CardHeader>
            <CardTitle>Fiyat Bilgileri</CardTitle>
            <CardDescription>
              Her fiyatın iki değeri var: kartta yazan (yeni fatura ve tekliflerde
              kullanılır) ve faturalarınızdan hesaplanan (gerçekleşen).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* ── ALIŞ EKSENİ ────────────────────────────────────────────── */}
              <section className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold">Alış</h3>

                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Kartta yazan</span>
                  <span className="text-lg font-medium tabular-nums">
                    {cardPurchase != null ? formatCurrency(cardPurchase) : "—"}
                  </span>
                </div>

                <div className="mt-3 border-t pt-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted-foreground">Faturalara göre</span>
                    <span className="text-lg font-medium tabular-nums">
                      {avgCost != null ? formatCurrency(avgCost) : "—"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {avgCost == null
                      ? "Fiyatı kayıtlı alış hareketi yok"
                      : product.lastPurchase
                        ? `Alış faturalarının ağırlıklı ortalaması · son alış ${formatCurrency(product.lastPurchase.unitPrice)} (${formatDay(product.lastPurchase.date)})`
                        : "Alış faturalarının ağırlıklı ortalaması"}
                  </p>
                  {/*
                    ₺0 çıkan ortalama GÖSTERİLİR ama düğme ÇIKMAZ: fiyatsız kesilmiş
                    fatura satırları ortalamayı sıfıra indirir, karta sıfır yazmak
                    hiçbir soruyu çözmez — düzeltilecek yer faturadır.
                  */}
                  {avgCost != null && avgCost > 0 && !samePrice(avgCost, cardPurchase) && (
                    <WriteAction>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        disabled={applying !== null}
                        onClick={() => applyDerivedPrice("purchase", roundPrice(avgCost))}
                      >
                        {applying === "purchase" ? "Güncelleniyor..." : "Fiyatı güncelle"}
                      </Button>
                    </WriteAction>
                  )}
                </div>
              </section>

              {/* ── SATIŞ EKSENİ ───────────────────────────────────────────── */}
              <section className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold">Satış</h3>

                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Kartta yazan</span>
                  <span className="text-lg font-medium tabular-nums text-green-600">
                    {cardSale != null ? formatCurrency(cardSale) : "—"}
                  </span>
                </div>

                <div className="mt-3 border-t pt-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted-foreground">Faturalara göre</span>
                    <span className="text-lg font-medium tabular-nums text-green-600">
                      {derivedSale ? formatCurrency(derivedSale.price) : "—"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {!derivedSale
                      ? "Bu üründen satış faturası kesilmemiş"
                      : `${
                          derivedSale.scope === "PERIOD"
                            ? `Son ${derivedSale.periodDays} günde`
                            : "Tüm zamanlarda"
                        } ${formatNumber(derivedSale.quantity)} ${product.unit} satıldı${
                          derivedSale.lastSaleDate
                            ? ` · son satış ${formatDay(derivedSale.lastSaleDate)}`
                            : ""
                        }`}
                  </p>
                  {derivedSale && derivedSale.price > 0 && !samePrice(derivedSale.price, cardSale) && (
                    <WriteAction>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        disabled={applying !== null}
                        onClick={() => applyDerivedPrice("sale", roundPrice(derivedSale.price))}
                      >
                        {applying === "sale" ? "Güncelleniyor..." : "Fiyatı güncelle"}
                      </Button>
                    </WriteAction>
                  )}
                </div>
              </section>
            </div>

            {/*
              Kâr, hesabın NEYE göre yapıldığı etiketin İÇİNDE yazacak şekilde
              duruyor. Önce "Kar Marjı / Kar Oranı" diye iki başlık vardı ve hangi
              maliyetin kullanıldığı en altta küçük bir dipnottaydı — kullanıcı
              rakamı karttaki alış fiyatıyla karşılaştırıp tutmadığını görüyordu.
            */}
            {margin && (
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-sm font-medium">
                  Kâr:{" "}
                  <span className="text-muted-foreground">
                    karttaki satış fiyatı −{" "}
                    {avgCost != null ? "faturalara göre maliyet" : "karttaki alış fiyatı"}
                  </span>
                </p>
                <p
                  className={`mt-1 text-lg font-semibold tabular-nums ${
                    margin.profit < 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {formatCurrency(margin.profit)}{" "}
                  <span className="text-base font-medium opacity-80">
                    ({formatRate(margin.rate)})
                  </span>
                </p>
              </div>
            )}

            <p className="text-xs leading-snug text-muted-foreground">
              Tutarlar KDV hariçtir. Faturalara göre satış fiyatı, satır iskontosu
              düşülmüş net fiyattır ve satış iadeleri çıkarılmıştır.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stock Movements */}
      <Card>
        <CardHeader>
          <CardTitle>Stok Hareketleri</CardTitle>
          <CardDescription>
            Tüm giriş ve çıkış hareketleri
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Hareket</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead>Referans</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
                <TableHead className="text-right">Bakiye</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Henüz stok hareketi yok</p>
                  </TableCell>
                </TableRow>
              ) : (
                product.movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      {new Date(movement.date).toLocaleDateString("tr-TR")}
                    </TableCell>
                  <TableCell>
                      <span className={`px-2 py-1 rounded text-xs ${TONE_BADGE[movementTone(movement.quantity)]}`}>
                        {movementLabel(movement)}
                      </span>
                    </TableCell>
                    <TableCell>{movement.description || "-"}</TableCell>
                    <TableCell>
                      {/* Fatura kaynaklı hareket belgeye link olur; `from` geri
                          dönüşü bu ürün kartına bağlar. Diğer kaynaklar için bkz.
                          referenceLabel. */}
                      {movement.invoice ? (
                        <Link
                          href={`/faturalar/${movement.invoice.id}/onizleme?company=${encodeURIComponent(
                            companyId ?? ""
                          )}&from=${encodeURIComponent(`/stok/${id}`)}`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {movement.invoice.no}
                        </Link>
                      ) : movement.waybill ? (
                        <Link
                          href={waybillHref(movement.waybill, companyId)}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          İrsaliye {movement.waybill.no}
                        </Link>
                      ) : (
                        referenceLabel(movement.referenceNo)
                      )}
                    </TableCell>
                    <TableCell className={`text-right ${TONE_TEXT[movementTone(movement.quantity)]}`}>
                      {movement.quantity > 0 ? "+" : movement.quantity < 0 ? "-" : ""}
                      {formatNumber(Math.abs(movement.quantity))} {product.unit}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(movement.unitPrice, movement.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(movement.totalAmount, movement.currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatNumber(movement.balanceAfter)} {product.unit}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {companyId && canMoveStock && (
        <StockMovementDialog
          companyId={companyId}
          product={{
            id: product.id,
            name: product.name,
            unit: product.unit,
            stockQuantity: product.stockQuantity,
            purchasePrice: product.purchasePrice ?? null,
          }}
          open={movementOpen}
          onOpenChange={setMovementOpen}
          initialMode={movementMode}
          onSaved={() => {
            fetchProduct()
            fetchWarehouseStocks()
          }}
        />
      )}

      {companyId && (
        <ProductEditDialog
          companyId={companyId}
          product={product}
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          onSaved={fetchProduct}
        />
      )}
    </div>
  )
}

