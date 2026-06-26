"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ProductCombobox } from "@/components/ui/product-combobox"
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
import { Plus, RefreshCcw, Trash2, FileText, Minus, Search, ScrollText, Hourglass, CheckCircle2 } from "lucide-react"

type Quote = {
  id: string
  quoteNo: string
  status: string
  date: string
  validUntil?: string | null
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

// İptal/CONVERTED hariç, kullanıcı elle değiştirebilen RFQ durumları.
const EDITABLE_STATUSES: Record<string, string> = {
  DRAFT: "Taslak",
  SENT: "Gönderildi",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
  EXPIRED: "Süresi doldu",
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

export default function SatinAlmaTeklifiPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string; purchasePrice?: number | null }>>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [form, setForm] = useState({
    supplierId: "",
    currency: "TRY",
    date: new Date().toISOString().split("T")[0],
    validUntil: "",
    notes: "",
  })
  const [lines, setLines] = useState<ItemLine[]>([emptyLine()])

  async function fetchQuotes() {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/teklif?companyId=${companyId}&party=supplier`)
      if (res.ok) setQuotes(await res.json())
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

  async function createQuote() {
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
      const res = await fetch("/api/teklif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          supplierId: form.supplierId,
          currency: form.currency,
          date: form.date,
          validUntil: form.validUntil || null,
          notes: form.notes || null,
          items,
        }),
      })
      if (res.ok) {
        toast({ title: "Teklif oluşturuldu" })
        setForm({
          supplierId: "",
          currency: "TRY",
          date: new Date().toISOString().split("T")[0],
          validUntil: "",
          notes: "",
        })
        setLines([emptyLine()])
        setIsCreateOpen(false)
        fetchQuotes()
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
    const res = await fetch(`/api/teklif/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      toast({ title: "Durum güncellendi" })
      fetchQuotes()
    } else {
      toast({ title: "Hata", description: "Durum güncellenemedi", variant: "destructive" })
    }
  }

  async function convertToInvoice(quoteId: string) {
    if (!companyId) return
    if (!confirm("Bu teklifi alış faturasına dönüştürmek istiyor musunuz?")) return
    const res = await fetch(`/api/teklif/${quoteId}/faturaya-donustur`, { method: "POST" })
    if (res.ok) {
      toast({ title: "Teklif faturaya dönüştürüldü" })
      const invoice = await res.json().catch(() => null)
      if (invoice?.id) {
        router.push(`/faturalar/${invoice.id}/onizleme?company=${encodeURIComponent(companyId)}`)
        return
      }
      fetchQuotes()
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

  async function removeQuote(quoteId: string) {
    if (!confirm("Bu teklifi silmek istediğinize emin misiniz?")) return
    const res = await fetch(`/api/teklif/${quoteId}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Teklif silindi" })
      fetchQuotes()
    } else {
      toast({ title: "Hata", description: "Silinemedi", variant: "destructive" })
    }
  }

  useEffect(() => {
    fetchQuotes()
    fetchSuppliers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  const term = search.trim().toLocaleLowerCase("tr-TR")
  const filtered = quotes.filter((q) => {
    if (statusFilter !== "ALL" && q.status !== statusFilter) return false
    if (!term) return true
    return (
      q.quoteNo.toLocaleLowerCase("tr-TR").includes(term) ||
      (q.supplier?.name || "").toLocaleLowerCase("tr-TR").includes(term)
    )
  })

  const openAmount = quotes
    .filter((q) => ["DRAFT", "SENT", "APPROVED"].includes(q.status))
    .reduce((s, q) => s + Number(q.totalAmount), 0)
  const convertedAmount = quotes
    .filter((q) => q.status === "CONVERTED")
    .reduce((s, q) => s + Number(q.totalAmount), 0)

  const liveTotals = computeLineTotals(lines)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue">
              <ScrollText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Toplam Teklif</p>
              <p className="text-xl font-bold">{quotes.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Hourglass className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Açık Teklif Tutarı</p>
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
            <CardTitle>Satın Alma Teklifleri</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={fetchQuotes}>
                <RefreshCcw className="mr-1 h-4 w-4" />
                Yenile
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-1 h-4 w-4" />
                    Yeni Teklif
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Yeni Satın Alma Teklifi</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Tedarikçi</Label>
                        <Select
                          value={form.supplierId}
                          onValueChange={(value) => setForm((prev) => ({ ...prev, supplierId: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Tedarikçi seçin" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((supplier) => (
                              <SelectItem key={supplier.id} value={supplier.id}>
                                {supplier.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                        <Label>Teklif Tarihi</Label>
                        <Input
                          type="date"
                          value={form.date}
                          onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label>Geçerlilik</Label>
                        <Input
                          type="date"
                          value={form.validUntil}
                          onChange={(e) => setForm((prev) => ({ ...prev, validUntil: e.target.value }))}
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
                    <Button className="w-full" onClick={createQuote} disabled={isSaving}>
                      {isSaving ? "Kaydediliyor…" : "Kaydet"}
                    </Button>
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
                placeholder="Teklif no veya tedarikçi ara…"
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
                <SelectItem value="SENT">Gönderildi</SelectItem>
                <SelectItem value="APPROVED">Onaylandı</SelectItem>
                <SelectItem value="REJECTED">Reddedildi</SelectItem>
                <SelectItem value="EXPIRED">Süresi doldu</SelectItem>
                <SelectItem value="CONVERTED">Faturalandı</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && quotes.length === 0 && (
            <div className="text-sm text-muted-foreground">Henüz satın alma teklifi yok.</div>
          )}
          {!isLoading && quotes.length > 0 && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground">Aramayla eşleşen teklif yok.</div>
          )}
          {!isLoading && filtered.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>No</StyledTableHead>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>Geçerlilik</StyledTableHead>
                    <StyledTableHead>Tedarikçi</StyledTableHead>
                    <StyledTableHead className="text-center">Kalem</StyledTableHead>
                    <StyledTableHead className="w-[150px]">Durum</StyledTableHead>
                    <StyledTableHead className="text-right">Toplam</StyledTableHead>
                    <StyledTableHead className="w-[100px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((quote, idx) => (
                    <StyledTableRow key={quote.id} index={idx}>
                      <TableCell className="font-mono text-xs font-medium">{quote.quoteNo}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(quote.date).toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("tr-TR") : "—"}
                      </TableCell>
                      <TableCell>
                        <EntityCell name={quote.supplier?.name} />
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {quote._count?.items ?? 0}
                      </TableCell>
                      <TableCell>
                        {quote.status === "CONVERTED" ? (
                          <Badge variant="outline">Faturalandı</Badge>
                        ) : (
                          <Select value={quote.status} onValueChange={(v) => updateStatus(quote.id, v)}>
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(EDITABLE_STATUSES).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">
                        {Number(quote.totalAmount).toFixed(2)} {quote.currency || "TRY"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={quote.status === "CONVERTED"}
                            onClick={() => convertToInvoice(quote.id)}
                            title={quote.status === "CONVERTED" ? "Zaten faturalandı" : "Faturaya dönüştür"}
                          >
                            <FileText className="h-4 w-4 text-kobipo-blue" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={quote.status === "CONVERTED"}
                            onClick={() => removeQuote(quote.id)}
                            title={quote.status === "CONVERTED" ? "Faturalanmış teklif silinemez" : "Sil"}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
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
