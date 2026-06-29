"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ProductCombobox } from "@/components/ui/product-combobox"
import { SearchSelect } from "@/components/ui/search-select"
import { quickCreateProduct } from "@/lib/stock/quick-create-product"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
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
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
  MonoCell,
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, RefreshCcw, Trash2, Eye, Minus } from "lucide-react"

type Quote = {
  id: string
  quoteNo: string
  status: string
  date: string
  validUntil?: string | null
  totalAmount: number
  netAmount: number
  vatAmount: number
  currency?: string
  customer?: { name: string } | null
  items: Array<{
    description: string
    quantity: number
    unitPrice: number
    vatRate: number
    discountRate?: number | null
  }>
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
    case "DRAFT":
      return "secondary"
    case "SENT":
      return "default"
    case "APPROVED":
      return "default"
    case "REJECTED":
      return "destructive"
    case "EXPIRED":
      return "outline"
    case "CONVERTED":
      return "outline"
    default:
      return "secondary"
  }
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    DRAFT: "Taslak",
    SENT: "Gönderildi",
    APPROVED: "Onaylandı",
    REJECTED: "Reddedildi",
    EXPIRED: "Süresi doldu",
    CONVERTED: "Faturalandı",
  }
  return map[status] || status
}

export default function TeklifPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string; salePrice?: number | null }>>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [form, setForm] = useState({
    customerId: "",
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
      const res = await fetch(`/api/teklif?companyId=${companyId}&party=customer`)
      if (res.ok) setQuotes(await res.json())
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
  }, [isCreateOpen, companyId])

  function updateLine(index: number, patch: Partial<ItemLine>) {
    setLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function applyProductToLine(index: number, productId: string) {
    const p = products.find((x) => x.id === productId)
    updateLine(index, {
      productId,
      description: p?.name || "",
      unitPrice: p?.salePrice != null ? String(Number(p.salePrice)) : lines[index]?.unitPrice || "0",
    })
  }

  async function createQuote() {
    if (!companyId) return
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

    const res = await fetch("/api/teklif", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        customerId: form.customerId || null,
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
        customerId: "",
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
  }

  async function removeQuote(quoteId: string) {
    if (!(await confirm({ title: "Teklifi sil", description: "Bu teklifi silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
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
    fetchCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  const companyQs = `?company=${encodeURIComponent(companyId)}`

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Teklifler</CardTitle>
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
                    <DialogTitle>Yeni Teklif</DialogTitle>
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
                        <Label>Tarih</Label>
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
                                onCreateProduct={async (name) => {
                                  if (!companyId) return false
                                  try {
                                    const created = await quickCreateProduct({ companyId, name, salePrice: row.unitPrice, vatRate: row.vatRate })
                                    setProducts((prev) => [...prev, created])
                                    updateLine(index, {
                                      productId: created.id,
                                      description: created.name,
                                      unitPrice: created.salePrice != null ? String(created.salePrice) : row.unitPrice,
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
                    <Button className="w-full" onClick={createQuote}>
                      Kaydet
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && quotes.length === 0 && (
            <div className="text-sm text-muted-foreground">Henüz teklif yok.</div>
          )}
          {!isLoading && quotes.length > 0 && (
            <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>No</StyledTableHead>
                  <StyledTableHead>Tarih</StyledTableHead>
                  <StyledTableHead>Geçerlilik</StyledTableHead>
                  <StyledTableHead>Müşteri</StyledTableHead>
                  <StyledTableHead>Durum</StyledTableHead>
                  <StyledTableHead className="text-right">Toplam</StyledTableHead>
                  <StyledTableHead className="w-[100px] text-right">İşlem</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {quotes.map((quote, idx) => (
                  <StyledTableRow
                    key={quote.id}
                    index={idx}
                    className="cursor-pointer"
                    onClick={() => router.push(`/teklif/${quote.id}${companyQs}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/teklif/${quote.id}${companyQs}`}
                        className="font-mono text-xs text-kobipo-blue hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {quote.quoteNo}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(quote.date).toLocaleDateString("tr-TR")}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("tr-TR") : "—"}
                    </TableCell>
                    <TableCell>
                      <EntityCell name={quote.customer?.name} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(quote.status)}>{statusLabel(quote.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">
                      {Number(quote.totalAmount).toFixed(2)} {quote.currency || "TRY"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" asChild title="Detayı aç">
                          <Link href={`/teklif/${quote.id}${companyQs}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={quote.status === "CONVERTED"}
                          onClick={() => removeQuote(quote.id)}
                          title={
                            quote.status === "CONVERTED"
                              ? "Faturalanmış teklif silinemez"
                              : "Sil"
                          }
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
