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
  TableHeader,
} from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
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
import { Plus, RefreshCcw, Trash2, FileText, Search, ScrollText, Hourglass, CheckCircle2, Eye } from "lucide-react"

type Quote = {
  id: string
  slug?: string
  quoteNo: string
  status: string
  date: string
  validUntil?: string | null
  totalAmount: number
  currency?: string
  supplier?: { name: string } | null
  _count?: { items: number }
}

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

export default function SatinAlmaTeklifiPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<QuoteProduct[]>([])
  // Güncel TCMB kurları (USD/EUR → TRY). Modal açılınca çekilir; ürünün para
  // birimi belge para biriminden farklıysa fiyat bununla çevrilir.
  const [rates, setRates] = useState<{ USD: number; EUR: number; date: string } | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  // Tedarikçi listede yoksa buradan eklenir; seçiciye yazılan ad forma taşınır.
  // Cari kartı yazma yetkisi yoksa "Yeni cari ekle" seçeneği hiç çizilmez
  // (sunucu kapısı da aynı sahipliği uygular: lib/page-access.ts → /api/cari/*).
  const canCreateCari = useCanCreateCari().supplier
  const [quickCari, setQuickCari] = useState({ open: false, name: "" })
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [form, setForm] = useState({
    supplierId: "",
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

  async function fetchRates() {
    try {
      const res = await fetch("/api/kur")
      const data = await res.json()
      if (data?.success) {
        setRates({ USD: Number(data.USD), EUR: Number(data.EUR), date: String(data.date || "") })
      }
    } catch {
      /* kur alınamadıysa sessiz geç; çeviri denenince kullanıcı uyarılır */
    }
  }

  useEffect(() => {
    if (isCreateOpen && companyId) {
      fetchProducts()
      fetchRates()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateOpen, companyId])

  // Kur yardımcıları: X → TRY oranı ve iki para birimi arası çeviri (kur yoksa null).
  const rateOf = (cur: string): number =>
    (({ TRY: 1, USD: rates?.USD || 0, EUR: rates?.EUR || 0 }) as Record<string, number>)[cur] ?? 0
  const convert = (value: number, from: string, to: string): number | null => {
    if (from === to) return value
    const rf = rateOf(from)
    const rt = rateOf(to)
    if (!rf || !rt) return null
    return value * (rf / rt)
  }

  // Belge para birimi değişince mevcut satırların birim fiyat + referans fiyatını
  // eski→yeni para birimine güncel kurla çevir (satış teklifiyle aynı davranış).
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
    if (!form.supplierId) {
      toast({ title: "Eksik bilgi", description: "Tedarikçi seçin.", variant: "destructive" })
      return
    }
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
    if (!(await confirm({ title: "Faturaya dönüştür", description: "Bu teklifi alış faturasına dönüştürmek istiyor musunuz?", confirmLabel: "Dönüştür" }))) return
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
    fetchSuppliers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  // Panel içi her gezinme seçili firmayı TAŞIMAK zorunda (bkz. CLAUDE.md):
  // param'sız bir link bağlamı düşürür ve kullanıcı başka firmanın verisine geçer.
  const companyQs = `?company=${encodeURIComponent(companyId)}`

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
                  <WriteAction><Button size="sm">
                    <Plus className="mr-1 h-4 w-4" />
                    Yeni Teklif
                  </Button></WriteAction>
                </DialogTrigger>
                <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>Yeni Satın Alma Teklifi</DialogTitle>
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
                        <Select value={form.currency} onValueChange={changeCurrency}>
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
                    <QuoteLinesEditor
                      lines={lines}
                      onChange={setLines}
                      products={products}
                      onProductsChange={(updater) => setProducts(updater)}
                      companyId={companyId}
                      currency={form.currency}
                      priceMode="purchase"
                      convert={convert}
                    />
                    <div>
                      <Label>Not</Label>
                      <Input
                        placeholder="Not"
                        value={form.notes}
                        onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                      />
                    </div>
                    <QuoteTotalsSummary lines={lines} currency={form.currency} />
                    <WriteAction><Button className="w-full" onClick={createQuote} disabled={isSaving}>
                      {isSaving ? "Kaydediliyor…" : "Kaydet"}
                    </Button></WriteAction>
                    {/* İç içe dialog: teklif formu açıkken tedarikçi eklenir, kayıt
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
                    <StyledTableHead className="w-[130px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((quote, idx) => (
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
                      <TableCell onClick={(e) => e.stopPropagation()}>
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
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" asChild title="Detayı aç">
                            <Link href={`/teklif/${quote.slug || quote.id}${companyQs}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={quote.status === "CONVERTED"}
                            onClick={() => convertToInvoice(quote.id)}
                            title={quote.status === "CONVERTED" ? "Zaten faturalandı" : "Faturaya dönüştür"}
                          >
                            <FileText className="h-4 w-4 text-kobipo-blue" />
                          </Button>
                          <WriteAction><Button
                            size="sm"
                            variant="ghost"
                            disabled={quote.status === "CONVERTED"}
                            onClick={() => removeQuote(quote.id)}
                            title={quote.status === "CONVERTED" ? "Faturalanmış teklif silinemez" : "Sil"}
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
