"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { CompanyLink } from "@/components/dashboard/company-link"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, Edit, Trash2, Package } from "lucide-react"

const fmtQty = (n: number) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })

interface Warehouse {
  id: string
  code?: string
  name: string
  address?: string
  city?: string
  isDefault?: boolean
  isActive: boolean
}

export default function DepolarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null)
  const [stockSummary, setStockSummary] = useState<Record<string, { productCount: number; totalQuantity: number }>>({})

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    address: "",
    city: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchWarehouses()
    }
  }, [companyId])

  const fetchWarehouses = async () => {
    if (!companyId) return
    try {
      const [response, stockRes] = await Promise.all([
        fetch(`/api/depolar?companyId=${companyId}`),
        fetch(`/api/depolar/stok?companyId=${companyId}`),
      ])
      if (response.ok) {
        const data = await response.json()
        setWarehouses(data)
      }
      if (stockRes.ok) {
        const sd = await stockRes.json()
        const map: Record<string, { productCount: number; totalQuantity: number }> = {}
        for (const w of sd.warehouses || []) {
          map[w.id] = { productCount: w.productCount, totalQuantity: w.totalQuantity }
        }
        setStockSummary(map)
      }
    } catch (error) {
      console.error("Error fetching warehouses:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const url = editingWarehouse
        ? `/api/depolar/${editingWarehouse.id}`
        : "/api/depolar"
      const method = editingWarehouse ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          ...formData,
        }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: editingWarehouse
            ? "Depo güncellendi"
            : "Depo oluşturuldu",
        })
        setIsModalOpen(false)
        setEditingWarehouse(null)
        setFormData({ code: "", name: "", address: "", city: "" })
        fetchWarehouses()
      } else {
        const error = await response.json()
        toast({
          title: "Hata",
          description: error.error || "İşlem başarısız",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Depoyu sil", description: "Bu depoyu silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return

    try {
      const response = await fetch(`/api/depolar/${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Depo silindi",
        })
        fetchWarehouses()
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const handleEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse)
    setFormData({
      code: warehouse.code || "",
      name: warehouse.name,
      address: warehouse.address || "",
      city: warehouse.city || "",
    })
    setIsModalOpen(true)
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Depolar</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Depo Yönetimi</CardTitle>
              <CardDescription>Depolarınızı yönetin</CardDescription>
            </div>
            <WriteAction><Button onClick={() => setIsModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Depo
            </Button></WriteAction>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>Ad</TableHead>
                <TableHead>Adres</TableHead>
                <TableHead>Şehir</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Varsayılan</TableHead>
                <TableHead className="text-right">Ürün</TableHead>
                <TableHead className="text-right">Toplam Stok</TableHead>
                <TableHead>İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    Henüz depo bulunmuyor
                  </TableCell>
                </TableRow>
              ) : (
                warehouses.map((warehouse) => (
                  <TableRow key={warehouse.id}>
                    <TableCell>{warehouse.code || "-"}</TableCell>
                    <TableCell className="font-medium">
                      <CompanyLink href={`/depolar/${warehouse.id}`} className="hover:underline underline-offset-2">
                        {warehouse.name}
                      </CompanyLink>
                    </TableCell>
                    <TableCell>{warehouse.address || "-"}</TableCell>
                    <TableCell>{warehouse.city || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={warehouse.isActive ? "default" : "secondary"}>
                        {warehouse.isActive ? "Aktif" : "Pasif"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {warehouse.isDefault ? (
                        <Badge variant="outline">Ana Depo</Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-right">{stockSummary[warehouse.id]?.productCount ?? 0}</TableCell>
                    <TableCell className="text-right whitespace-nowrap font-medium">
                      {fmtQty(stockSummary[warehouse.id]?.totalQuantity ?? 0)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <CompanyLink href={`/depolar/${warehouse.id}`}>
                          <Button variant="ghost" size="sm" title="Depo detayı: stok ve hareketler">
                            <Package className="h-4 w-4" />
                          </Button>
                        </CompanyLink>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(warehouse)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(warehouse.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingWarehouse ? "Depo Düzenle" : "Yeni Depo"}
            </DialogTitle>
            <DialogDescription>
              Depo bilgilerini girin
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Kod</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value })
                    }
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
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Adres</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({ ...formData, address: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Şehir</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) =>
                    setFormData({ ...formData, city: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsModalOpen(false)
                  setEditingWarehouse(null)
                  setFormData({ code: "", name: "", address: "", city: "" })
                }}
              >
                İptal
              </Button>
              <WriteAction><Button type="submit" disabled={isLoading}>
                {isLoading ? "Kaydediliyor..." : editingWarehouse ? "Güncelle" : "Kaydet"}
              </Button></WriteAction>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  )
}

