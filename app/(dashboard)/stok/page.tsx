"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Plus, Search, Eye, Pencil, Trash2 } from "lucide-react"
import Link from "next/link"

interface Product {
  id: string
  code?: string
  name: string
  barcode?: string
  unit: string
  vatRate: number
  purchasePrice?: number
  avgPurchasePrice?: number | null
  salePrice?: number
  stockQuantity: number
  isService: boolean
  isActive: boolean
}

const emptyProductForm = {
  code: "",
  name: "",
  barcode: "",
  unit: "ADET",
  vatRate: "20",
  purchasePrice: "",
  salePrice: "",
  stockQuantity: "0",
  minStockLevel: "",
  isService: false,
}

export default function StokPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState("")
  const [filterService, setFilterService] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({ ...emptyProductForm })

  useEffect(() => {
    if (companyId) {
      fetchProducts()
    }
  }, [companyId, search, filterService])

  const fetchProducts = async () => {
    if (!companyId) return

    try {
      const params = new URLSearchParams({
        companyId,
        ...(search && { search }),
        ...(filterService !== null && { isService: filterService }),
      })

      const response = await fetch(`/api/stok/products?${params}`)
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
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
        body: JSON.stringify({ ...formData, companyId }),
      })

      if (response.ok) {
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
      unit: product.unit,
      vatRate: String(product.vatRate),
      purchasePrice: product.purchasePrice ? String(product.purchasePrice) : "",
      salePrice: product.salePrice ? String(product.salePrice) : "",
      stockQuantity: String(product.stockQuantity),
      minStockLevel: (product as any).minStockLevel ? String((product as any).minStockLevel) : "",
      isService: product.isService,
    })
    setIsDialogOpen(true)
  }

  const deleteProduct = async (id: string) => {
    if (!confirm("Ürünü silmek istediğinize emin misiniz?")) return
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stok Yönetimi</h1>
          <p className="text-muted-foreground">
            Ürün ve hizmet kartları
          </p>
        </div>
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
                  <Input
                    id="unit"
                    value={formData.unit}
                    onChange={(e) =>
                      setFormData({ ...formData, unit: e.target.value })
                    }
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
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Ürünler ve Hizmetler</CardTitle>
              <CardDescription>
                Toplam {products.length} kayıt
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
                <StyledTableHead>Barkod</StyledTableHead>
                <StyledTableHead>Birim</StyledTableHead>
                <StyledTableHead>KDV %</StyledTableHead>
                <StyledTableHead className="text-right">Ort. Alış Fiyatı</StyledTableHead>
                <StyledTableHead className="text-right">Satış Fiyatı</StyledTableHead>
                <StyledTableHead className="text-right">Stok</StyledTableHead>
                <StyledTableHead>Tip</StyledTableHead>
                <StyledTableHead>İşlem</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center">
                    Kayıt bulunamadı
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product, idx) => (
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
                      {product.isService
                        ? "-"
                        : new Intl.NumberFormat("tr-TR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }).format(Number(product.stockQuantity))}
                    </TableCell>
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

