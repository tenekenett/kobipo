"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { AlertTriangle, ArrowLeftRight, Boxes, PackageCheck, TrendingUp, Search, RefreshCcw } from "lucide-react"
import { ExportButton } from "@/components/export/export-button"
import Link from "next/link"

interface Product {
  id: string
  code?: string | null
  name: string
  barcode?: string | null
  unit: string
  vatRate: number | string
  purchasePrice?: number | string | null
  salePrice?: number | string | null
  stockQuantity: number | string
  minStockLevel?: number | string | null
  isService: boolean
  isActive: boolean
}

type FilterType = "ALL" | "PRODUCT" | "SERVICE"
type StockFilter = "ALL" | "LOW" | "OUT" | "NORMAL"

export default function StokRaporlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")

  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<FilterType>("ALL")
  const [stockFilter, setStockFilter] = useState<StockFilter>("ALL")

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
      }),
    []
  )
  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  )

  useEffect(() => {
    if (!companyId) return
    void fetchData()
  }, [companyId])

  const fetchData = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const productsRes = await fetch(`/api/stok/products?companyId=${companyId}`, {
        cache: "no-store",
      })
      if (productsRes.ok) setProducts(await productsRes.json())
    } catch (error) {
      console.error("Stok raporu verisi alınamadı:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const stats = useMemo(() => {
    const onlyProducts = products.filter((p) => !p.isService)
    const onlyServices = products.filter((p) => p.isService)
    const totalStockValue = onlyProducts.reduce((sum, p) => {
      const qty = Number(p.stockQuantity || 0)
      const price = Number(p.purchasePrice || 0)
      return sum + qty * price
    }, 0)
    const totalSaleValue = onlyProducts.reduce((sum, p) => {
      const qty = Number(p.stockQuantity || 0)
      const price = Number(p.salePrice || 0)
      return sum + qty * price
    }, 0)
    const lowStock = onlyProducts.filter((p) => {
      const min = Number(p.minStockLevel || 0)
      const qty = Number(p.stockQuantity || 0)
      return min > 0 && qty <= min && qty > 0
    }).length
    const outOfStock = onlyProducts.filter((p) => Number(p.stockQuantity || 0) <= 0).length
    return {
      productCount: onlyProducts.length,
      serviceCount: onlyServices.length,
      totalStockValue,
      totalSaleValue,
      potentialMargin: totalSaleValue - totalStockValue,
      lowStock,
      outOfStock,
    }
  }, [products])

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (typeFilter === "PRODUCT" && p.isService) return false
      if (typeFilter === "SERVICE" && !p.isService) return false

      const qty = Number(p.stockQuantity || 0)
      const min = Number(p.minStockLevel || 0)
      if (stockFilter === "OUT" && qty > 0) return false
      if (stockFilter === "LOW" && !(min > 0 && qty > 0 && qty <= min)) return false
      if (stockFilter === "NORMAL" && (qty <= 0 || (min > 0 && qty <= min))) return false

      if (search) {
        const q = search.toLowerCase()
        const hit =
          p.name.toLowerCase().includes(q) ||
          (p.code || "").toLowerCase().includes(q) ||
          (p.barcode || "").toLowerCase().includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [products, typeFilter, stockFilter, search])

  const stockStatus = (p: Product) => {
    const qty = Number(p.stockQuantity || 0)
    const min = Number(p.minStockLevel || 0)
    if (p.isService) return { label: "Hizmet", variant: "secondary" as const }
    if (qty <= 0) return { label: "Stok Yok", variant: "destructive" as const }
    if (min > 0 && qty <= min) return { label: "Kritik", variant: "destructive" as const }
    return { label: "Normal", variant: "default" as const }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stok Raporu</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stok Raporu</h1>
          <p className="text-muted-foreground">
            Stok durumu ve değerleme
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            dataset="rapor-stok"
            companyId={companyId}
            params={{ search, type: typeFilter, stock: stockFilter }}
          />
          {/* Hareket listesi bu sayfadan ÇIKARILDI: tarih/cari/tanım süzgeçleriyle
              kendi sayfasında yaşıyor. Kapısı sayfanın DİBİNDE bir kart olarak
              duruyordu ve tablo uzayınca görünmüyordu; başlığa alındı. */}
          <Link href={`/raporlar/stok/hareketler?company=${encodeURIComponent(companyId)}`}>
            <Button variant="outline" size="sm">
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Stok Hareketleri
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {isLoading ? "Yükleniyor..." : "Yenile"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Toplam Ürün</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.productCount}</div>
            <p className="text-xs text-muted-foreground">
              {stats.serviceCount} hizmet kartı
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stok Maliyeti</CardTitle>
            <PackageCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {currencyFormatter.format(stats.totalStockValue)}
            </div>
            <p className="text-xs text-muted-foreground">
              Alış fiyatı × mevcut stok
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Potansiyel Ciro</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {currencyFormatter.format(stats.totalSaleValue)}
            </div>
            <p
              className={`text-xs ${
                stats.potentialMargin >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              Marj: {currencyFormatter.format(stats.potentialMargin)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stok Uyarısı</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {stats.lowStock + stats.outOfStock}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.outOfStock} stok yok · {stats.lowStock} kritik seviye
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Stok Durumu</CardTitle>
              <CardDescription>
                {filteredProducts.length} kayıt listeleniyor
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ürün ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-56 pl-8"
                />
              </div>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FilterType)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tümü</SelectItem>
                  <SelectItem value="PRODUCT">Ürünler</SelectItem>
                  <SelectItem value="SERVICE">Hizmetler</SelectItem>
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tüm Stoklar</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="LOW">Kritik</SelectItem>
                  <SelectItem value="OUT">Stok Yok</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>Ad</TableHead>
                <TableHead>Birim</TableHead>
                <TableHead className="text-right">Mevcut</TableHead>
                <TableHead className="text-right">Min.</TableHead>
                <TableHead className="text-right">Alış</TableHead>
                <TableHead className="text-right">Satış</TableHead>
                <TableHead className="text-right">Stok Değeri</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    {isLoading ? "Yükleniyor..." : "Kayıt bulunamadı"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map((p) => {
                  const qty = Number(p.stockQuantity || 0)
                  const purchase = Number(p.purchasePrice || 0)
                  const sale = Number(p.salePrice || 0)
                  const status = stockStatus(p)
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{p.code || "-"}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.unit}</TableCell>
                      <TableCell className="text-right">
                        {p.isService ? "-" : numberFormatter.format(qty)}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.isService || !p.minStockLevel
                          ? "-"
                          : numberFormatter.format(Number(p.minStockLevel))}
                      </TableCell>
                      <TableCell className="text-right">
                        {purchase ? currencyFormatter.format(purchase) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {sale ? currencyFormatter.format(sale) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {p.isService ? "-" : currencyFormatter.format(qty * purchase)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  )
}
