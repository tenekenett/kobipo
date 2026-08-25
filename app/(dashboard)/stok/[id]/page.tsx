"use client"

import { useEffect, useState } from "react"
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
import { ArrowLeft, Package, TrendingUp, TrendingDown, BarChart3, Pencil } from "lucide-react"
import Link from "next/link"
import { looksLikeCuid } from "@/lib/slug"
import { formatMoney } from "@/lib/format"
import { ProductEditDialog } from "@/components/stok/product-edit-dialog"
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

  useEffect(() => {
    if (id && companyId) {
      fetchProduct()
    }
  }, [id, companyId])

  useEffect(() => {
    if (!id || !companyId) return
    fetch(`/api/depolar/stok?companyId=${companyId}&productId=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.stocks) {
          setWhStocks(d.stocks.map((s: any) => ({ warehouseName: s.warehouseName, quantity: s.quantity, unit: s.unit })))
        }
      })
      .catch(() => {})
  }, [id, companyId])

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
        <div className="flex items-center gap-2">
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
              {formatCurrency(Number(product.stockQuantity) * Number(product.purchasePrice || 0))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product Details */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ürün / Hizmet Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <div>
                <p className="text-sm font-medium text-muted-foreground">Tip</p>
                <p className="font-medium">{product.isService ? "Hizmet" : "Ürün"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fiyat Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Alış Fiyatı</p>
                <p className="font-medium text-lg">
                  {product.purchasePrice ? formatCurrency(Number(product.purchasePrice)) : "-"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Satış Fiyatı</p>
                <p className="font-medium text-lg text-green-600">
                  {product.salePrice ? formatCurrency(Number(product.salePrice)) : "-"}
                </p>
              </div>
              {product.purchasePrice && product.salePrice && (
                <>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Kar Marjı</p>
                    <p className="font-medium">
                      {formatCurrency(Number(product.salePrice) - Number(product.purchasePrice))}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Kar Oranı</p>
                    <p className="font-medium">
                      %{(((Number(product.salePrice) - Number(product.purchasePrice)) / Number(product.purchasePrice)) * 100).toFixed(1)}
                    </p>
                  </div>
                </>
              )}
            </div>
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
                      <span className={`px-2 py-1 rounded text-xs ${
                        ["IN", "PURCHASE", "SALE_CANCEL", "RETURN"].includes(movement.type) || movement.quantity > 0 ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" :
                        ["OUT", "SALE", "PURCHASE_CANCEL", "RETURN_CANCEL"].includes(movement.type) || movement.quantity < 0 ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" :
                        "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300"
                      }`}>
                        {["IN", "PURCHASE", "SALE_CANCEL", "RETURN"].includes(movement.type) || movement.quantity > 0 ? "Giriş" :
                         ["OUT", "SALE", "PURCHASE_CANCEL", "RETURN_CANCEL"].includes(movement.type) || movement.quantity < 0 ? "Çıkış" :
                         movement.type === "TRANSFER" ? "Transfer" :
                         "Düzeltme"}
                      </span>
                    </TableCell>
                    <TableCell>{movement.description || "-"}</TableCell>
                    <TableCell>{movement.referenceNo || "-"}</TableCell>
                    <TableCell className={`text-right ${
                      ["IN", "PURCHASE", "SALE_CANCEL", "RETURN"].includes(movement.type) || movement.quantity > 0 ? "text-green-600" : 
                      ["OUT", "SALE", "PURCHASE_CANCEL", "RETURN_CANCEL"].includes(movement.type) || movement.quantity < 0 ? "text-red-600" : ""
                    }`}>
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

