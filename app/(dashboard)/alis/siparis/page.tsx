"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
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
import { Badge } from "@/components/ui/badge"
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
import { Plus, RefreshCcw, Trash2, FileText, Minus, Search, Ban, ShoppingCart, Wallet, CheckCircle2 } from "lucide-react"

type Order = {
  id: string
  orderNo: string
  status: string
  date: string
  deliveryDate?: string | null
  totalAmount: number
  currency?: string
  supplier?: { name: string } | null
  _count?: { items: number }
}

type ItemLine = {
  productId: string
  description: string
  quantity: string
  unitPrice: string
  vatRate: string
  discountRate: string
}

const emptyLine = (): ItemLine => ({
  productId: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  vatRate: "20",
  discountRate: "0",
})

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "OPEN":
      return "default"
    case "PARTIAL":
      return "secondary"
    case "COMPLETED":
      return "default"
    case "CANCELLED":
      return "destructive"
    case "CONVERTED":
      return "outline"
    default:
      return "secondary"
  }
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    OPEN: "Açık",
    PARTIAL: "Kısmi",
    COMPLETED: "Tamamlandı",
    CANCELLED: "İptal",
    CONVERTED: "Faturalandı",
  }
  return map[status] || status
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function computeLineTotals(lines: { quantity: string; unitPrice: string; discountRate: string; vatRate: string }[]) {
  let net = 0
  let vat = 0
  for (const row of lines) {
    const gross = Number(row.quantity || 0) * Number(row.unitPrice || 0)
    const lineNet = gross - gross * (Number(row.discountRate || 0) / 100)
    net += lineNet
    vat += lineNet * (Number(row.vatRate || 0) / 100)
  }
  return { net, vat, total: net + vat }
}

export default function AlisSiparisPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string; purchasePrice?: number | null }>>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  // Tedarikçi listede yoksa buradan eklenir; seçiciye yazılan ad forma taşınır.
  // Cari kartı yazma yetkisi yoksa "Yeni cari ekle" seçeneği hiç çizilmez
  // (sunucu kapısı da aynı sahipliği uygular: lib/page-access.ts → /api/cari/*).
  const canCreateCari = useCanCreateCari().supplier
  const [quickCari, setQuickCari] = useState({ open: false, name: "" })
  const [form, setForm] = useState({
    supplierId: "",
    currency: "TRY",
    date: new Date().toISOString().split("T")[0],
    deliveryDate: "",
    notes: "",
  })
  const [lines, setLines] = useState<ItemLine[]>([emptyLine()])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")

  async function fetchOrders() {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/siparis?companyId=${companyId}&type=PURCHASE`)
      if (res.ok) setOrders(await res.json())
    } finally {
      setIsLoading(false)
    }
  }

  async function fetchSuppliers() {
    if (!companyId) return
    const res = await fetch(`/api/cari/suppliers?companyId=${companyId}`)
    if (res.ok) setSuppliers(await res.json())
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
      unitPrice: p?.purchasePrice != null ? String(Number(p.purchasePrice)) : lines[index]?.unitPrice || "0",
    })
  }

  async function createOrder() {
    if (!companyId) return
    if (!form.supplierId) {
      toast({ title: "Eksik bilgi", description: "Tedarikçi seçin.", variant: "destructive" })
      return
    }
    const items = lines
      .map((row) => ({
        productId: row.productId || null,
        description: row.description.trim() || "Kalem",
        quantity: Number(row.quantity || 0),
        unitPrice: Number(row.unitPrice || 0),
        vatRate: Number(row.vatRate || 0),
        discountRate: Number(row.discountRate || 0),
      }))
      .filter((row) => row.description.length > 0)

    if (!items.length) {
      toast({ title: "Eksik bilgi", description: "En az bir geçerli kalem girin.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch("/api/siparis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: "PURCHASE",
          supplierId: form.supplierId,
          currency: form.currency,
          date: form.date,
          deliveryDate: form.deliveryDate || null,
          notes: form.notes || null,
          items,
        }),
      })
      if (res.ok) {
        toast({ title: "Sipariş oluşturuldu" })
        setForm({
          supplierId: "",
          currency: "TRY",
          date: new Date().toISOString().split("T")[0],
          deliveryDate: "",
          notes: "",
        })
        setLines([emptyLine()])
        setIsCreateOpen(false)
        fetchOrders()
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

  async function convertToInvoice(orderId: string) {
    if (!companyId) return
    if (!(await confirm({ title: "Faturaya dönüştür", description: "Bu siparişi alış faturasına dönüştürmek istiyor musunuz?", confirmLabel: "Dönüştür" }))) return
    const res = await fetch(`/api/siparis/${orderId}/faturaya-donustur`, { method: "POST" })
    if (res.ok) {
      toast({ title: "Sipariş faturaya dönüştürüldü" })
      const invoice = await res.json().catch(() => null)
      if (invoice?.id) {
        router.push(`/faturalar/${invoice.id}/onizleme?company=${encodeURIComponent(companyId)}`)
        return
      }
      fetchOrders()
    } else {
      let message = "Dönüştürülemedi"
      try {
        const data = await res.json()
        if (typeof data?.error === "string") message = data.error
      } catch {
        /* ignore */
      }
      toast({ title: "Hata", description: message, variant: "destructive" })
    }
  }

  async function removeOrder(orderId: string) {
    if (!(await confirm({ title: "Siparişi sil", description: "Bu siparişi silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/siparis/${orderId}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Sipariş silindi" })
      fetchOrders()
    } else {
      let message = "Silinemedi"
      try {
        const data = await res.json()
        if (typeof data?.error === "string") message = data.error
      } catch {
        /* ignore */
      }
      toast({ title: "Hata", description: message, variant: "destructive" })
    }
  }

  async function cancelOrder(orderId: string) {
    if (!(await confirm({ title: "Siparişi iptal et", description: "Bu siparişi iptal etmek istediğinize emin misiniz?", confirmLabel: "İptal et", variant: "destructive" }))) return
    const res = await fetch(`/api/siparis/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    })
    if (res.ok) {
      toast({ title: "Sipariş iptal edildi" })
      fetchOrders()
    } else {
      toast({ title: "Hata", description: "İptal edilemedi", variant: "destructive" })
    }
  }

  useEffect(() => {
    fetchOrders()
    fetchSuppliers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  const term = search.trim().toLocaleLowerCase("tr-TR")
  const filtered = orders.filter((o) => {
    if (statusFilter !== "ALL" && o.status !== statusFilter) return false
    if (!term) return true
    return (
      o.orderNo.toLocaleLowerCase("tr-TR").includes(term) ||
      (o.supplier?.name || "").toLocaleLowerCase("tr-TR").includes(term)
    )
  })

  const openAmount = orders
    .filter((o) => o.status === "OPEN" || o.status === "PARTIAL")
    .reduce((s, o) => s + Number(o.totalAmount), 0)
  const convertedAmount = orders
    .filter((o) => o.status === "CONVERTED")
    .reduce((s, o) => s + Number(o.totalAmount), 0)

  const liveTotals = computeLineTotals(lines)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Toplam Sipariş</p>
              <p className="text-xl font-bold">{orders.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Açık Sipariş Tutarı</p>
              <p className="text-xl font-bold">{fmt(openAmount)} ₺</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Faturalanan Tutar</p>
              <p className="text-xl font-bold">{fmt(convertedAmount)} ₺</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Alış Siparişleri</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={fetchOrders}>
                <RefreshCcw className="mr-1 h-4 w-4" />
                Yenile
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <WriteAction><Button size="sm">
                    <Plus className="mr-1 h-4 w-4" />
                    Yeni Sipariş
                  </Button></WriteAction>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Yeni Alış Siparişi</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Tedarikçi</Label>
                        <SearchSelect
                          options={suppliers}
                          value={form.supplierId}
                          onChange={(value) => setForm((prev) => ({ ...prev, supplierId: value }))}
                          placeholder="Tedarikçi seçin veya arayın…"
                          onCreate={canCreateCari ? (name) => setQuickCari({ open: true, name }) : undefined}
                          createLabel="Yeni tedarikçi ekle"
                        />
                      </div>
                      <div>
                        <Label>Para birimi</Label>
                        <Select
                          value={form.currency}
                          onValueChange={(value) => setForm((prev) => ({ ...prev, currency: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TRY">TRY</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Sipariş Tarihi</Label>
                        <Input
                          type="date"
                          value={form.date}
                          onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label>Beklenen Teslim</Label>
                        <Input
                          type="date"
                          value={form.deliveryDate}
                          onChange={(e) => setForm((prev) => ({ ...prev, deliveryDate: e.target.value }))}
                        />
                      </div>
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
                                    const created = await quickCreateProduct({ companyId, name, purchasePrice: row.unitPrice, vatRate: row.vatRate })
                                    setProducts((prev) => [...prev, created])
                                    updateLine(index, {
                                      productId: created.id,
                                      description: created.name,
                                      unitPrice: created.purchasePrice != null ? String(created.purchasePrice) : row.unitPrice,
                                    })
                                    return true
                                  } catch (e) {
                                    toast({ title: "Hata", description: e instanceof Error ? e.message : "Ürün eklenemedi", variant: "destructive" })
                                    return false
                                  }
                                }}
                              />
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:col-span-5">
                              <div>
                                <Label className="text-xs text-muted-foreground">Miktar</Label>
                                <Input
                                  type="number"
                                  value={row.quantity}
                                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Birim fiyat</Label>
                                <Input
                                  type="number"
                                  value={row.unitPrice}
                                  onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">İsk. %</Label>
                                <Input
                                  type="number"
                                  value={row.discountRate}
                                  onChange={(e) => updateLine(index, { discountRate: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">KDV %</Label>
                                <Input
                                  type="number"
                                  value={row.vatRate}
                                  onChange={(e) => updateLine(index, { vatRate: e.target.value })}
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
                    <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Ara Toplam</span>
                        <span>{fmt(liveTotals.net)} {form.currency}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>KDV</span>
                        <span>{fmt(liveTotals.vat)} {form.currency}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>Genel Toplam</span>
                        <span>{fmt(liveTotals.total)} {form.currency}</span>
                      </div>
                    </div>
                    <WriteAction><Button className="w-full" onClick={createOrder} disabled={isSaving}>
                      {isSaving ? "Kaydediliyor…" : "Kaydet"}
                    </Button></WriteAction>
                    {/* İç içe dialog: sipariş formu açıkken tedarikçi eklenir, kayıt
                        sonrası seçiciye düşer (form kaybolmadan). */}
                    {companyId && (
                      <QuickCariDialog
                        open={quickCari.open}
                        onOpenChange={(open) => setQuickCari((prev) => ({ ...prev, open }))}
                        companyId={companyId}
                        defaultKind="supplier"
                        initialName={quickCari.name}
                        requireTaxFields={false}
                        onCreated={(created, kind) => {
                          if (kind !== "supplier") {
                            toast({
                              title: "Müşteri olarak kaydedildi",
                              description: "Tedarikçi listesine eklenmedi, seçim yapılmadı.",
                            })
                            return
                          }
                          setSuppliers((prev) =>
                            prev.some((s) => s.id === created.id)
                              ? prev
                              : [...prev, { id: created.id, name: created.name }]
                          )
                          setForm((prev) => ({ ...prev, supplierId: created.id }))
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
                placeholder="Sipariş no veya tedarikçi ara…"
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
                <SelectItem value="OPEN">Açık</SelectItem>
                <SelectItem value="PARTIAL">Kısmi</SelectItem>
                <SelectItem value="COMPLETED">Tamamlandı</SelectItem>
                <SelectItem value="CONVERTED">Faturalandı</SelectItem>
                <SelectItem value="CANCELLED">İptal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && orders.length === 0 && (
            <div className="text-sm text-muted-foreground">Henüz alış siparişi yok.</div>
          )}
          {!isLoading && orders.length > 0 && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground">Aramayla eşleşen sipariş yok.</div>
          )}
          {!isLoading && filtered.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>No</StyledTableHead>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>Teslim</StyledTableHead>
                    <StyledTableHead>Tedarikçi</StyledTableHead>
                    <StyledTableHead className="text-center">Kalem</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                    <StyledTableHead className="text-right">Toplam</StyledTableHead>
                    <StyledTableHead className="w-[150px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((order, idx) => (
                    <StyledTableRow key={order.id} index={idx}>
                      <TableCell className="font-mono text-xs font-medium">{order.orderNo}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(order.date).toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString("tr-TR") : "—"}
                      </TableCell>
                      <TableCell>
                        <EntityCell name={order.supplier?.name} />
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {order._count?.items ?? 0}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(order.status)}>{statusLabel(order.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">
                        {Number(order.totalAmount).toFixed(2)} {order.currency || "TRY"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={order.status === "CONVERTED" || order.status === "CANCELLED"}
                            onClick={() => convertToInvoice(order.id)}
                            title={order.status === "CONVERTED" ? "Zaten faturalandı" : "Faturaya dönüştür"}
                          >
                            <FileText className="h-4 w-4 text-kobipo-blue" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={order.status === "CONVERTED" || order.status === "CANCELLED"}
                            onClick={() => cancelOrder(order.id)}
                            title={order.status === "CANCELLED" ? "Zaten iptal" : "İptal et"}
                          >
                            <Ban className="h-4 w-4 text-amber-600" />
                          </Button>
                          <WriteAction><Button
                            size="sm"
                            variant="ghost"
                            disabled={order.status === "CONVERTED"}
                            onClick={() => removeOrder(order.id)}
                            title={order.status === "CONVERTED" ? "Faturalanmış sipariş silinemez" : "Sil"}
                          >
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
