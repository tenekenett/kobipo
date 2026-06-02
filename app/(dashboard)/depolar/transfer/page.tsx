"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Transfer {
  id: string
  createdAt: string
  quantity: number
  product: {
    name: string
  }
  warehouse: {
    name: string
  } | null
  notes?: string
}

export default function DepoTransferPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [form, setForm] = useState({
    productId: "",
    fromWarehouseId: "",
    toWarehouseId: "",
    quantity: "1",
    notes: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchTransfers()
      fetchLookups()
    }
  }, [companyId])

  const fetchTransfers = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/depolar/transfer?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setTransfers(data)
      }
    } catch (error) {
      console.error("Error fetching transfers:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchLookups = async () => {
    if (!companyId) return
    const [productRes, warehouseRes] = await Promise.all([
      fetch(`/api/stok/products?companyId=${companyId}`),
      fetch(`/api/depolar?companyId=${companyId}`),
    ])
    if (productRes.ok) {
      const data = await productRes.json()
      setProducts(data)
    }
    if (warehouseRes.ok) {
      const data = await warehouseRes.json()
      setWarehouses(data)
    }
  }

  const submitTransfer = async () => {
    if (!companyId || !form.productId || !form.fromWarehouseId || !form.toWarehouseId || !form.quantity) return
    const response = await fetch("/api/depolar/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        productId: form.productId,
        fromWarehouseId: form.fromWarehouseId,
        toWarehouseId: form.toWarehouseId,
        quantity: Number(form.quantity),
        notes: form.notes,
      }),
    })
    if (response.ok) {
      setIsCreateOpen(false)
      setForm({ productId: "", fromWarehouseId: "", toWarehouseId: "", quantity: "1", notes: "" })
      fetchTransfers()
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Depo Transfer İşlemleri</CardTitle>
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
              <CardTitle>Depo Transfer İşlemleri</CardTitle>
              <CardDescription>Depolar arası transfer kayıtları</CardDescription>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Yeni Transfer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Yeni Depo Transferi</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Select value={form.productId} onValueChange={(value) => setForm((prev) => ({ ...prev, productId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Ürün seçin" /></SelectTrigger>
                    <SelectContent>
                      {products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={form.fromWarehouseId} onValueChange={(value) => setForm((prev) => ({ ...prev, fromWarehouseId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Kaynak depo" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={form.toWarehouseId} onValueChange={(value) => setForm((prev) => ({ ...prev, toWarehouseId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Hedef depo" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="Miktar" value={form.quantity} onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))} />
                  <Input placeholder="Açıklama" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
                  <Button className="w-full" onClick={submitTransfer}>Kaydet</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : transfers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz transfer kaydı bulunmuyor
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Ürün</TableHead>
                  <TableHead>Depo</TableHead>
                  <TableHead className="text-right">Miktar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => (
                  <TableRow key={transfer.id}>
                    <TableCell>
                      {new Date(transfer.createdAt).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell className="font-medium">{transfer.product.name}</TableCell>
                    <TableCell>{transfer.warehouse?.name || "-"}</TableCell>
                    <TableCell className={`text-right ${transfer.quantity >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {transfer.quantity > 0 ? "+" : ""}{transfer.quantity.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

