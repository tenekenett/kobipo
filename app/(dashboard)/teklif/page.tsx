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
import { Plus, RefreshCcw, Trash2, Eye } from "lucide-react"

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

type ItemLine = {
  productId: string
  description: string
  quantity: string
  unitPrice: string
  vatRate: string
  discountRate: string
  cost: string // birim maliyet — ürün seçilince ort. alış fiyatından dolar, elle düzenlenebilir
}

const emptyLine = (): ItemLine => ({
  productId: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
  vatRate: "20",
  discountRate: "0",
  cost: "",
})

// Kalem grid kolon şablonu — başlık satırı ile input satırları aynı hizada olsun diye
// tek yerden yönetilir. (Ürün | Miktar | B.Fiyat | İsk% | KDV% | Maliyet | Tutar | Sil)
const GRID_COLS =
  "md:grid-cols-[minmax(0,1fr)_60px_104px_58px_58px_90px_112px_32px]"

// Para (2 ondalık) ve birim fiyat (6 ondalık — e-Fatura hassasiyeti) yuvarlaması.
// İkisi de gereksiz ondalık üretmeden temiz string'e çevrilebilsin diye number döner.
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const round6 = (n: number) => Math.round((Number(n) || 0) * 1_000_000) / 1_000_000

// Bir kalemin brüt/iskonto/net/kdv/toplam değerleri.
function calcLine(row: ItemLine) {
  const qty = Number(row.quantity) || 0
  const price = Number(row.unitPrice) || 0
  const disc = Number(row.discountRate) || 0
  const vat = Number(row.vatRate) || 0
  const gross = qty * price
  const discount = gross * (disc / 100)
  const net = gross - discount
  const vatAmount = net * (vat / 100)
  return { gross, discount, net, vatAmount, total: net + vatAmount }
}

// Grid içinde etiketli sayı girişi (etiket yalnızca mobilde; masaüstünde başlık satırı var).
function GridNumber({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  prefix?: string
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">{label}</span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${prefix ? "pl-5" : ""}`}
        />
      </div>
    </div>
  )
}

// Para birimi simgesi.
const currencySymbol = (cur: string): string =>
  ({ TRY: "₺", USD: "$", EUR: "€" } as Record<string, string>)[cur] || cur

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
  const [products, setProducts] = useState<
    Array<{
      id: string
      name: string
      salePrice?: number | null
      avgPurchasePrice?: number | null
      currency?: string | null
    }>
  >([])
  // Güncel TCMB kurları (USD/EUR → TRY). Modal açılınca çekilir; ürünün para birimi
  // belge para biriminden farklıysa fiyat bununla çevrilir.
  const [rates, setRates] = useState<{ USD: number; EUR: number; date: string } | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [form, setForm] = useState({
    customerId: "",
    currency: "TRY",
    date: new Date().toISOString().split("T")[0],
    validUntil: "",
    notes: "",
  })
  const [lines, setLines] = useState<ItemLine[]>([emptyLine()])
  // Tutar hücresi düzenlenirken kullanıcının ham girdisini tutar (recompute ile
  // çakışmasın diye). Odak varken input bu değeri gösterir; birim fiyat arka planda
  // tutar/miktar olarak güncellenir. Odak gidince yeniden hesaplanan tutar gösterilir.
  const [amountEdit, setAmountEdit] = useState<{ index: number; value: string } | null>(null)

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
  }, [isCreateOpen, companyId])

  function updateLine(index: number, patch: Partial<ItemLine>) {
    setLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

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

  function applyProductToLine(index: number, productId: string) {
    const p = products.find((x) => x.id === productId)
    const prodCur = (p?.currency || "TRY").toUpperCase()
    const docCur = (form.currency || "TRY").toUpperCase()

    let unitPrice = p?.salePrice != null ? Number(p.salePrice) : Number(lines[index]?.unitPrice || 0)
    let cost = p?.avgPurchasePrice != null ? Number(p.avgPurchasePrice) : null

    // Ürün para birimi belge para biriminden farklıysa fiyatı VE maliyeti çevir.
    if (prodCur !== docCur && (p?.salePrice != null || cost != null)) {
      const cp = convert(unitPrice, prodCur, docCur)
      if (cp != null) {
        if (p?.salePrice != null) {
          toast({
            title: "Döviz çevrildi",
            description: `${Number(p.salePrice).toLocaleString("tr-TR")} ${prodCur} → ${round6(cp).toLocaleString("tr-TR")} ${docCur}`,
          })
        }
        unitPrice = round6(cp)
        if (cost != null) {
          const cc = convert(cost, prodCur, docCur)
          if (cc != null) cost = round6(cc)
        }
      } else {
        toast({
          title: "Kur bulunamadı",
          description: `${prodCur} güncel kuru alınamadı; fiyat çevrilmeden eklendi.`,
          variant: "destructive",
        })
      }
    }

    updateLine(index, {
      productId,
      description: p?.name || "",
      unitPrice: String(unitPrice),
      cost: cost != null ? String(round6(cost)) : "",
    })
  }

  // Belge para birimi değişince mevcut satırların birim fiyat + maliyetini eski→yeni
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
          const patch: Partial<ItemLine> = {
            unitPrice: String(round6((Number(row.unitPrice) || 0) * factor)),
          }
          if (row.cost && row.cost.trim() !== "") {
            patch.cost = String(round6((Number(row.cost) || 0) * factor))
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

  // Modal alt toplamları (canlı) + para formatı + belge para birimi simgesi.
  const fmt = (n: number) =>
    n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const curSym = currencySymbol(form.currency)
  const totals = lines.reduce(
    (acc, row) => {
      const c = calcLine(row)
      acc.gross += c.gross
      acc.discount += c.discount
      acc.vat += c.vatAmount
      acc.total += c.total
      return acc
    },
    { gross: 0, discount: 0, vat: 0, total: 0 },
  )

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
                      <div className="mb-2 flex items-center justify-between">
                        <Label>Kalemler</Label>
                        <Button type="button" size="sm" variant="outline" onClick={() => setLines((l) => [...l, emptyLine()])}>
                          <Plus className="mr-1 h-3 w-3" />
                          Satır
                        </Button>
                      </div>
                      <div className="rounded-md border p-3">
                        {/* Başlık satırı (masaüstü) — satırlarla aynı grid şablonu */}
                        <div className={`hidden gap-2 px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid ${GRID_COLS}`}>
                          <div>Ürün / Açıklama</div>
                          <div className="text-right">Miktar</div>
                          <div className="text-right">Birim Fiyat</div>
                          <div className="text-right">İsk %</div>
                          <div className="text-right">KDV %</div>
                          <div className="text-right">Maliyet</div>
                          <div className="text-right">Tutar</div>
                          <div />
                        </div>

                        <div className="space-y-3 md:space-y-2">
                          {lines.map((row, index) => {
                            const c = calcLine(row)
                            return (
                              <div
                                key={index}
                                className={`grid grid-cols-2 items-start gap-2 rounded-md border p-2 md:items-center md:rounded-none md:border-0 md:border-b md:p-0 md:pb-2 md:last:border-0 ${GRID_COLS}`}
                              >
                                <div className="col-span-2 md:col-span-1">
                                  <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">Ürün / Açıklama</span>
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
                                          cost: "",
                                        })
                                        return true
                                      } catch (e) {
                                        toast({ title: "Hata", description: e instanceof Error ? e.message : "Ürün eklenemedi", variant: "destructive" })
                                        return false
                                      }
                                    }}
                                  />
                                </div>
                                <GridNumber label="Miktar" value={row.quantity} onChange={(v) => updateLine(index, { quantity: v })} />
                                <GridNumber label="Birim Fiyat" value={row.unitPrice} onChange={(v) => updateLine(index, { unitPrice: v })} prefix={curSym} />
                                <GridNumber label="İsk %" value={row.discountRate} onChange={(v) => updateLine(index, { discountRate: v })} />
                                <GridNumber label="KDV %" value={row.vatRate} onChange={(v) => updateLine(index, { vatRate: v })} />
                                <div>
                                  <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">Maliyet</span>
                                  <div className="flex h-9 items-center justify-end px-1 text-xs text-muted-foreground tabular-nums" title="Birim maliyet (ortalama alış)">
                                    {row.cost && row.cost.trim() !== "" ? `${curSym} ${fmt(Number(row.cost))}` : "—"}
                                  </div>
                                </div>
                                <div>
                                  <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">Tutar</span>
                                  <div className="relative">
                                    <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                      {curSym}
                                    </span>
                                  <Input
                                    type="number"
                                    className="h-9 pl-5 text-right font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    value={amountEdit?.index === index ? amountEdit.value : String(round2(c.gross))}
                                    onFocus={() => setAmountEdit({ index, value: String(round2(c.gross)) })}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setAmountEdit({ index, value: v })
                                      const qty = Number(row.quantity) || 0
                                      if (qty > 0 && v.trim() !== "") {
                                        const up = Number(v) / qty
                                        if (Number.isFinite(up)) updateLine(index, { unitPrice: String(round6(up)) })
                                      }
                                    }}
                                    onBlur={() => setAmountEdit(null)}
                                    title="Satır tutarı — düzenlenince birim fiyat (tutar ÷ miktar) otomatik hesaplanır"
                                  />
                                  </div>
                                </div>
                                <div className="col-span-2 flex justify-end md:col-span-1 md:justify-center">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                    disabled={lines.length <= 1}
                                    onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                                    title="Satırı sil"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Toplam özeti */}
                      <div className="mt-3 flex justify-end">
                        <div className="w-full max-w-xs space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Ara Toplam</span>
                            <span className="tabular-nums">{fmt(totals.gross)} {form.currency}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">İskonto</span>
                            <span className="tabular-nums">
                              {totals.discount > 0 ? "-" : ""}
                              {fmt(totals.discount)} {form.currency}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">KDV</span>
                            <span className="tabular-nums">{fmt(totals.vat)} {form.currency}</span>
                          </div>
                          <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
                            <span>Genel Toplam</span>
                            <span className="tabular-nums">{fmt(totals.total)} {form.currency}</span>
                          </div>
                        </div>
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
