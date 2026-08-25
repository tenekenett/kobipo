"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchSelect } from "@/components/ui/search-select"
import { QuickCariDialog, useCanCreateCari } from "@/components/e-donusum/quick-cari-dialog"
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
import {
  QuoteLinesEditor,
  QuoteTotalsSummary,
  emptyQuoteLine,
  round6,
  type QuoteLine,
  type QuoteProduct,
} from "@/components/teklif/quote-lines"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, RefreshCcw, Trash2, Eye } from "lucide-react"
import { useTcmbRates } from "@/lib/exchange/use-rates"

type Quote = {
  id: string
  slug?: string
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
  const [products, setProducts] = useState<QuoteProduct[]>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  // Müşteri listede yoksa buradan eklenir; seçiciye yazılan ad forma taşınır.
  // Cari kartı yazma yetkisi yoksa "Yeni cari ekle" seçeneği hiç çizilmez
  // (sunucu kapısı da aynı sahipliği uygular: lib/page-access.ts → /api/cari/*).
  const canCreateCari = useCanCreateCari().customer
  const [quickCari, setQuickCari] = useState({ open: false, name: "" })
  const [form, setForm] = useState({
    customerId: "",
    currency: "TRY",
    date: new Date().toISOString().split("T")[0],
    validUntil: "",
    notes: "",
  })
  const [lines, setLines] = useState<QuoteLine[]>([emptyQuoteLine()])

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
    if (isCreateOpen && companyId) {
      fetchProducts()
    }
  }, [isCreateOpen, companyId])

  // Güncel TCMB kurları + çeviri (lib/exchange/use-rates.ts). Modal açılınca
  // çekilir; ürünün para birimi belge para biriminden farklıysa fiyat bununla
  // çevrilir (bkz. quote-lines.tsx applyProductToLine).
  const { rates, convert } = useTcmbRates(isCreateOpen && !!companyId)

  // Belge para birimi değişince mevcut satırların birim fiyat + referans fiyatını eski→yeni
  // para birimine güncel kurla çevir.
  function changeCurrency(next: string) {
    const oldCur = (form.currency || "TRY").toUpperCase()
    const newCur = next.toUpperCase()
    if (newCur === oldCur) return
    const factor = convert(1, oldCur, newCur)
    if (factor == null) {
      toast({
        title: "Kur alınamadı",
        description: "Güncel kur olmadan tutarlar çevrilemedi; para birimi değişti, değerler aynı kaldı.",
        variant: "destructive",
      })
    } else if (factor !== 1) {
      setLines((prev) =>
        prev.map((row) => {
          const patch: Partial<QuoteLine> = {
            unitPrice: String(round6((Number(row.unitPrice) || 0) * factor)),
          }
          if (row.refPrice && row.refPrice.trim() !== "") {
            patch.refPrice = String(round6((Number(row.refPrice) || 0) * factor))
          }
          return { ...row, ...patch }
        }),
      )
    }
    setForm((prev) => ({ ...prev, currency: newCur }))
  }

  async function createQuote() {
    if (!companyId) return
    const items = lines
      .map((row) => ({
        productId: row.productId || null,
        description: row.description.trim() || "Kalem",
        note: row.note.trim() || null,
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
      setLines([emptyQuoteLine()])
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
                  <WriteAction><Button size="sm">
                    <Plus className="mr-1 h-4 w-4" />
                    Yeni Teklif
                  </Button></WriteAction>
                </DialogTrigger>
                <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
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
                          onCreate={canCreateCari ? (name) => setQuickCari({ open: true, name }) : undefined}
                          createLabel="Yeni müşteri ekle"
                        />
                      </div>
                      <div>
                        <Label>Para birimi</Label>
                        <Select
                          value={form.currency}
                          onValueChange={changeCurrency}
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
                        {rates && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            TCMB{rates.date ? ` ${rates.date}` : ""}: 1 USD = {rates.USD.toLocaleString("tr-TR")} ₺ · 1 EUR ={" "}
                            {rates.EUR.toLocaleString("tr-TR")} ₺
                          </p>
                        )}
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
                      <QuoteLinesEditor
                        lines={lines}
                        onChange={setLines}
                        products={products}
                        onProductsChange={(updater) => setProducts(updater)}
                        companyId={companyId}
                        currency={form.currency}
                        priceMode="sale"
                        convert={convert}
                      />
                      <QuoteTotalsSummary lines={lines} currency={form.currency} />
                    </div>
                    <div>
                      <Label>Not</Label>
                      <Input
                        placeholder="Not"
                        value={form.notes}
                        onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                      />
                    </div>
                    <WriteAction><Button className="w-full" onClick={createQuote}>
                      Kaydet
                    </Button></WriteAction>
                    {/* İç içe dialog: teklif formu açıkken müşteri eklenir, kayıt
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
                    onClick={() => router.push(`/teklif/${quote.slug || quote.id}${companyQs}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/teklif/${quote.slug || quote.id}${companyQs}`}
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
                          <Link href={`/teklif/${quote.slug || quote.id}${companyQs}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <WriteAction><Button
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
