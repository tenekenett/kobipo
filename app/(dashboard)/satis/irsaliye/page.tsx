"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ProductCombobox } from "@/components/ui/product-combobox"
import { SearchSelect } from "@/components/ui/search-select"
import { QuickCariDialog, useCanCreateCari } from "@/components/e-donusum/quick-cari-dialog"
import { quickCreateProduct } from "@/lib/stock/quick-create-product"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
} from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, RefreshCcw, Trash2, Minus, Search, Truck, PackageCheck, Clock } from "lucide-react"

type Waybill = {
  id: string
  waybillNo: string
  status: string
  date: string
  deliveryDate?: string | null
  carrier?: string | null
  vehicleNo?: string | null
  customer?: { name: string } | null
  _count?: { items: number }
}

type ItemLine = {
  productId: string
  description: string
  quantity: string
  unit: string
  weight: string
}

const emptyLine = (): ItemLine => ({
  productId: "",
  description: "",
  quantity: "1",
  unit: "ADET",
  weight: "",
})

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Taslak",
  SENT: "Sevk edildi",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal",
}

export default function SatisIrsaliyePage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [waybills, setWaybills] = useState<Waybill[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string; unit?: string | null }>>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  // Müşteri listede yoksa buradan eklenir; seçiciye yazılan ad forma taşınır.
  // Cari kartı yazma yetkisi yoksa "Yeni cari ekle" seçeneği hiç çizilmez
  // (sunucu kapısı da aynı sahipliği uygular: lib/page-access.ts → /api/cari/*).
  const canCreateCari = useCanCreateCari().customer
  const [quickCari, setQuickCari] = useState({ open: false, name: "" })
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [form, setForm] = useState({
    customerId: "",
    date: new Date().toISOString().split("T")[0],
    deliveryDate: "",
    carrier: "",
    vehicleNo: "",
    driverName: "",
    deliveryAddress: "",
    notes: "",
  })
  const [lines, setLines] = useState<ItemLine[]>([emptyLine()])

  async function fetchWaybills() {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/irsaliye?companyId=${companyId}&type=SALES`)
      if (res.ok) setWaybills(await res.json())
    } finally {
      setIsLoading(false)
    }
  }

  async function fetchCustomers() {
    if (!companyId) return
    const res = await fetch(`/api/cari/customers?companyId=${companyId}`)
    if (res.ok) setCustomers(await res.json())
  }

  async function fetchProducts() {
    if (!companyId) return
    const res = await fetch(`/api/stok/products?companyId=${companyId}`)
    if (res.ok) setProducts(await res.json())
  }

  useEffect(() => {
    if (isCreateOpen && companyId) fetchProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateOpen, companyId])

  function updateLine(index: number, patch: Partial<ItemLine>) {
    setLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function applyProductToLine(index: number, productId: string) {
    const p = products.find((x) => x.id === productId)
    updateLine(index, {
      productId,
      description: p?.name || "",
      unit: p?.unit || lines[index]?.unit || "ADET",
    })
  }

  async function createWaybill() {
    if (!companyId) return
    if (!form.customerId) {
      toast({ title: "Eksik bilgi", description: "Müşteri seçin.", variant: "destructive" })
      return
    }
    const items = lines
      .map((row) => ({
        productId: row.productId || null,
        description: row.description.trim() || "Kalem",
        quantity: Number(row.quantity || 0),
        unit: row.unit || null,
        weight: row.weight || null,
      }))
      .filter((row) => row.description.length > 0)

    if (!items.length) {
      toast({ title: "Eksik bilgi", description: "En az bir geçerli kalem girin.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch("/api/irsaliye", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: "SALES",
          customerId: form.customerId,
          date: form.date,
          deliveryDate: form.deliveryDate || null,
          carrier: form.carrier || null,
          vehicleNo: form.vehicleNo || null,
          driverName: form.driverName || null,
          deliveryAddress: form.deliveryAddress || null,
          notes: form.notes || null,
          items,
        }),
      })
      if (res.ok) {
        toast({ title: "İrsaliye oluşturuldu" })
        setForm({
          customerId: "",
          date: new Date().toISOString().split("T")[0],
          deliveryDate: "",
          carrier: "",
          vehicleNo: "",
          driverName: "",
          deliveryAddress: "",
          notes: "",
        })
        setLines([emptyLine()])
        setIsCreateOpen(false)
        fetchWaybills()
      } else {
        let message = "Kayıt oluşturulamadı"
        try {
          const data = await res.json()
          if (typeof data?.error === "string") message = data.error
        } catch {
          /* ignore */
        }
        toast({ title: "Hata", description: message, variant: "destructive" })
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`/api/irsaliye/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      toast({ title: "Durum güncellendi" })
      fetchWaybills()
    } else {
      toast({ title: "Hata", description: "Durum güncellenemedi", variant: "destructive" })
    }
  }

  async function removeWaybill(id: string) {
    if (!(await confirm({ title: "İrsaliyeyi sil", description: "Bu irsaliyeyi silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/irsaliye/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "İrsaliye silindi" })
      fetchWaybills()
    } else {
      toast({ title: "Hata", description: "Silinemedi", variant: "destructive" })
    }
  }

  useEffect(() => {
    fetchWaybills()
    fetchCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  const term = search.trim().toLocaleLowerCase("tr-TR")
  const filtered = waybills.filter((w) => {
    if (statusFilter !== "ALL" && w.status !== statusFilter) return false
    if (!term) return true
    return (
      w.waybillNo.toLocaleLowerCase("tr-TR").includes(term) ||
      (w.customer?.name || "").toLocaleLowerCase("tr-TR").includes(term)
    )
  })

  const pendingCount = waybills.filter((w) => w.status === "DRAFT" || w.status === "SENT").length
  const deliveredCount = waybills.filter((w) => w.status === "DELIVERED").length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Toplam İrsaliye</p>
              <p className="text-xl font-bold">{waybills.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Bekleyen Sevkiyat</p>
              <p className="text-xl font-bold">{pendingCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Teslim Edilen</p>
              <p className="text-xl font-bold">{deliveredCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Satış İrsaliyeleri</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={fetchWaybills}>
                <RefreshCcw className="mr-1 h-4 w-4" />
                Yenile
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <WriteAction><Button size="sm">
                    <Plus className="mr-1 h-4 w-4" />
                    Yeni İrsaliye
                  </Button></WriteAction>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Yeni Satış İrsaliyesi</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Müşteri</Label>
                        <SearchSelect
                          options={customers}
                          value={form.customerId}
                          onChange={(value) => setForm((prev) => ({ ...prev, customerId: value }))}
                          placeholder="Müşteri seçin veya arayın…"
                          onCreate={canCreateCari ? (name) => setQuickCari({ open: true, name }) : undefined}
                          createLabel="Yeni müşteri ekle"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label>İrsaliye Tarihi</Label>
                          <Input
                            type="date"
                            value={form.date}
                            onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                          />
                        </div>
                        <div>
                          <Label>Sevk Tarihi</Label>
                          <Input
                            type="date"
                            value={form.deliveryDate}
                            onChange={(e) => setForm((prev) => ({ ...prev, deliveryDate: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label>Taşıyıcı</Label>
                        <Input
                          value={form.carrier}
                          onChange={(e) => setForm((prev) => ({ ...prev, carrier: e.target.value }))}
                          placeholder="Taşıyıcı firma"
                        />
                      </div>
                      <div>
                        <Label>Araç Plakası</Label>
                        <Input
                          value={form.vehicleNo}
                          onChange={(e) => setForm((prev) => ({ ...prev, vehicleNo: e.target.value }))}
                          placeholder="34 ABC 123"
                        />
                      </div>
                      <div>
                        <Label>Şoför</Label>
                        <Input
                          value={form.driverName}
                          onChange={(e) => setForm((prev) => ({ ...prev, driverName: e.target.value }))}
                          placeholder="Şoför adı"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Teslim Adresi</Label>
                      <Input
                        value={form.deliveryAddress}
                        onChange={(e) => setForm((prev) => ({ ...prev, deliveryAddress: e.target.value }))}
                        placeholder="Teslimat adresi"
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label>Kalemler</Label>
                        <Button type="button" size="sm" variant="outline" onClick={() => setLines((l) => [...l, emptyLine()])}>
                          <Plus className="mr-1 h-3 w-3" />
                          Satır
                        </Button>
                      </div>
                      <div className="space-y-3 rounded-md border p-3">
                        {lines.map((row, index) => (
                          <div key={index} className="grid gap-2 border-b pb-3 last:border-0 last:pb-0 sm:grid-cols-12">
                            <div className="sm:col-span-7">
                              <Label className="text-xs text-muted-foreground">Ürün / Açıklama</Label>
                              <ProductCombobox
                                products={products}
                                value={row.description}
                                onTextChange={(text) => updateLine(index, { description: text, productId: "" })}
                                onSelectProduct={(p) => applyProductToLine(index, p.id)}
                                onCreateProduct={async (name) => {
                                  if (!companyId) return false
                                  try {
                                    const created = await quickCreateProduct({ companyId, name, unit: row.unit })
                                    setProducts((prev) => [...prev, created])
                                    updateLine(index, {
                                      productId: created.id,
                                      description: created.name,
                                      unit: created.unit || row.unit,
                                    })
                                    return true
                                  } catch (e) {
                                    toast({ title: "Hata", description: e instanceof Error ? e.message : "Ürün eklenemedi", variant: "destructive" })
                                    return false
                                  }
                                }}
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2 sm:col-span-5">
                              <div>
                                <Label className="text-xs text-muted-foreground">Miktar</Label>
                                <Input
                                  type="number"
                                  value={row.quantity}
                                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Birim</Label>
                                <Input
                                  value={row.unit}
                                  onChange={(e) => updateLine(index, { unit: e.target.value })}
                                  placeholder="ADET"
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Ağırlık (kg)</Label>
                                <Input
                                  type="number"
                                  value={row.weight}
                                  onChange={(e) => updateLine(index, { weight: e.target.value })}
                                  placeholder="—"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end sm:col-span-12">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={lines.length <= 1}
                                onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label>Not</Label>
                      <Input
                        placeholder="Not"
                        value={form.notes}
                        onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                      />
                    </div>
                    <WriteAction><Button className="w-full" onClick={createWaybill} disabled={isSaving}>
                      {isSaving ? "Kaydediliyor…" : "Kaydet"}
                    </Button></WriteAction>
                    {/* İç içe dialog: irsaliye formu açıkken müşteri eklenir, kayıt
                        sonrası seçiciye düşer (form kaybolmadan). */}
                    {companyId && (
                      <QuickCariDialog
                        open={quickCari.open}
                        onOpenChange={(open) => setQuickCari((prev) => ({ ...prev, open }))}
                        companyId={companyId}
                        defaultKind="customer"
                        initialName={quickCari.name}
                        requireTaxFields={false}
                        onCreated={(created, kind) => {
                          if (kind !== "customer") {
                            toast({
                              title: "Tedarikçi olarak kaydedildi",
                              description: "Müşteri listesine eklenmedi, seçim yapılmadı.",
                            })
                            return
                          }
                          setCustomers((prev) =>
                            prev.some((c) => c.id === created.id)
                              ? prev
                              : [...prev, { id: created.id, name: created.name }]
                          )
                          setForm((prev) => ({ ...prev, customerId: created.id }))
                        }}
                      />
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="İrsaliye no veya müşteri ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tüm durumlar</SelectItem>
                <SelectItem value="DRAFT">Taslak</SelectItem>
                <SelectItem value="SENT">Sevk edildi</SelectItem>
                <SelectItem value="DELIVERED">Teslim edildi</SelectItem>
                <SelectItem value="CANCELLED">İptal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && waybills.length === 0 && (
            <div className="text-sm text-muted-foreground">Henüz satış irsaliyesi yok.</div>
          )}
          {!isLoading && waybills.length > 0 && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground">Aramayla eşleşen irsaliye yok.</div>
          )}
          {!isLoading && filtered.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>No</StyledTableHead>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>Müşteri</StyledTableHead>
                    <StyledTableHead className="text-center">Kalem</StyledTableHead>
                    <StyledTableHead>Taşıyıcı / Araç</StyledTableHead>
                    <StyledTableHead className="w-[150px]">Durum</StyledTableHead>
                    <StyledTableHead className="w-[60px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((w, idx) => (
                    <StyledTableRow key={w.id} index={idx}>
                      <TableCell className="font-mono text-xs font-medium">{w.waybillNo}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(w.date).toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell>
                        <EntityCell name={w.customer?.name} />
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {w._count?.items ?? 0}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {w.carrier || "—"}
                        {w.vehicleNo ? ` · ${w.vehicleNo}` : ""}
                      </TableCell>
                      <TableCell>
                        <Select value={w.status} onValueChange={(v) => updateStatus(w.id, v)}>
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          <WriteAction><Button size="sm" variant="ghost" onClick={() => removeWaybill(w.id)} title="Sil">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button></WriteAction>
                        </div>
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
