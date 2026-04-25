"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Waybill {
  id: string
  waybillNo: string
  type: string
  status: string
  date: string
  deliveryDate?: string
  carrier?: string
  vehicleNo?: string
  customer?: { name: string }
  supplier?: { name: string }
  invoice?: { invoiceNo: string }
}

export default function EirsaliyePage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [waybills, setWaybills] = useState<Waybill[]>([])
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [form, setForm] = useState({
    waybillNo: "",
    type: "SALES",
    customerId: "",
    supplierId: "",
    productId: "",
    quantity: "1",
    description: "",
  })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchWaybills()
      fetchLookups()
    }
  }, [companyId])

  const fetchWaybills = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/e-irsaliye?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setWaybills(data)
      }
    } catch (error) {
      console.error("Error fetching waybills:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchLookups = async () => {
    if (!companyId) return
    const [customerRes, supplierRes, productRes] = await Promise.all([
      fetch(`/api/cari/customers?companyId=${companyId}`),
      fetch(`/api/cari/suppliers?companyId=${companyId}`),
      fetch(`/api/stok/products?companyId=${companyId}`),
    ])
    if (customerRes.ok) {
      const data = await customerRes.json()
      setCustomers(data)
    }
    if (supplierRes.ok) {
      const data = await supplierRes.json()
      setSuppliers(data)
    }
    if (productRes.ok) {
      const data = await productRes.json()
      setProducts(data)
    }
  }

  const submitWaybill = async () => {
    if (!companyId || !form.waybillNo || !form.productId || !form.quantity) return
    const payload = {
      companyId,
      waybillNo: form.waybillNo,
      type: form.type,
      customerId: form.type === "SALES" ? form.customerId || null : null,
      supplierId: form.type === "PURCHASE" ? form.supplierId || null : null,
      date: new Date().toISOString(),
      items: [
        {
          productId: form.productId,
          description: form.description || "İrsaliye kalemi",
          quantity: Number(form.quantity),
          unit: "ADET",
        },
      ],
    }
    const response = await fetch("/api/e-irsaliye", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (response.ok) {
      setIsCreateOpen(false)
      setForm({
        waybillNo: "",
        type: "SALES",
        customerId: "",
        supplierId: "",
        productId: "",
        quantity: "1",
        description: "",
      })
      fetchWaybills()
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("tr-TR")
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>E-İrsaliye</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>E-İrsaliye</CardTitle>
              <CardDescription>E-İrsaliye yönetimi</CardDescription>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Yeni İrsaliye
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Yeni İrsaliye</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Input
                    placeholder="İrsaliye No"
                    value={form.waybillNo}
                    onChange={(e) => setForm((prev) => ({ ...prev, waybillNo: e.target.value }))}
                  />
                  <Select value={form.type} onValueChange={(value) => setForm((prev) => ({ ...prev, type: value }))}>
                    <SelectTrigger><SelectValue placeholder="Tip seçin" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SALES">Satış</SelectItem>
                      <SelectItem value="PURCHASE">Alış</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.type === "SALES" ? (
                    <Select value={form.customerId} onValueChange={(value) => setForm((prev) => ({ ...prev, customerId: value }))}>
                      <SelectTrigger><SelectValue placeholder="Müşteri seçin" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={form.supplierId} onValueChange={(value) => setForm((prev) => ({ ...prev, supplierId: value }))}>
                      <SelectTrigger><SelectValue placeholder="Tedarikçi seçin" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={form.productId} onValueChange={(value) => setForm((prev) => ({ ...prev, productId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Ürün seçin" /></SelectTrigger>
                    <SelectContent>
                      {products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder="Miktar"
                    value={form.quantity}
                    onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                  />
                  <Input
                    placeholder="Açıklama"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  />
                  <Button className="w-full" onClick={submitWaybill}>Kaydet</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : waybills.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz irsaliye bulunmuyor
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>İrsaliye No</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>Müşteri/Tedarikçi</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Taşıyıcı</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waybills.map((waybill) => (
                  <TableRow key={waybill.id}>
                    <TableCell className="font-medium">{waybill.waybillNo}</TableCell>
                    <TableCell>
                      <Badge variant={waybill.type === "SALES" ? "default" : "secondary"}>
                        {waybill.type === "SALES" ? "Satış" : "Alış"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {waybill.customer?.name || waybill.supplier?.name || "-"}
                    </TableCell>
                    <TableCell>{formatDate(waybill.date)}</TableCell>
                    <TableCell>{waybill.carrier || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={
                        waybill.status === "SENT" ? "default" :
                        waybill.status === "DELIVERED" ? "default" :
                        waybill.status === "CANCELLED" ? "destructive" : "secondary"
                      }>
                        {waybill.status === "SENT" ? "Gönderildi" :
                         waybill.status === "DELIVERED" ? "Teslim Edildi" :
                         waybill.status === "CANCELLED" ? "İptal" : "Taslak"}
                      </Badge>
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

