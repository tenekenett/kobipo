"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { ArrowLeft, Building2, Download, FileText, Landmark, Loader2, Minus, Plus, Save } from "lucide-react"

type QuoteItem = {
  id?: string
  productId?: string | null
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  discountRate?: number | null
  product?: { id: string; name: string } | null
}

type QuoteDetail = {
  id: string
  companyId: string
  quoteNo: string
  status: string
  date: string
  validUntil?: string | null
  currency: string
  notes?: string | null
  customerId?: string | null
  netAmount: number
  vatAmount: number
  totalAmount: number
  convertedInvoiceId?: string | null
  customer?: {
    id: string
    name: string
    taxNumber?: string | null
    taxOffice?: string | null
    address?: string | null
    city?: string | null
    phone?: string | null
    email?: string | null
  } | null
  items: QuoteItem[]
}

type CompanyInfo = {
  id: string
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
}

type BankAccount = {
  id: string
  code?: string | null
  name: string
  type: string
  bankName?: string | null
  accountNumber?: string | null
  iban?: string | null
  currency: string
  isActive: boolean
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

export default function TeklifDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [quote, setQuote] = useState<QuoteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [products, setProducts] = useState<Array<{ id: string; name: string; salePrice?: number | null }>>([])
  const [company, setCompany] = useState<CompanyInfo | null>(null)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

  const [customerId, setCustomerId] = useState("")
  const [currency, setCurrency] = useState("TRY")
  const [date, setDate] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<ItemLine[]>([emptyLine()])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/teklif/${id}`)
      if (!res.ok) {
        toast({ title: "Hata", description: "Teklif yüklenemedi", variant: "destructive" })
        setQuote(null)
        return
      }
      const data = (await res.json()) as QuoteDetail
      setQuote(data)
      setCustomerId(data.customerId || "")
      setCurrency(data.currency || "TRY")
      setDate(data.date ? new Date(data.date).toISOString().split("T")[0] : "")
      setValidUntil(data.validUntil ? new Date(data.validUntil).toISOString().split("T")[0] : "")
      setNotes(data.notes || "")
      if (data.items?.length) {
        setLines(
          data.items.map((it) => ({
            productId: it.productId || it.product?.id || "",
            description: it.description || "",
            quantity: String(Number(it.quantity) || 0),
            unitPrice: String(Number(it.unitPrice) || 0),
            vatRate: String(Number(it.vatRate) ?? 20),
            discountRate: String(Number(it.discountRate) ?? 0),
          }))
        )
      } else {
        setLines([emptyLine()])
      }
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!companyId) return
    fetch(`/api/cari/customers?companyId=${companyId}`).then(async (res) => {
      if (res.ok) setCustomers(await res.json())
    })
    fetch(`/api/stok/products?companyId=${companyId}`).then(async (res) => {
      if (res.ok) setProducts(await res.json())
    })
    fetch(`/api/companies/${companyId}`).then(async (res) => {
      if (res.ok) setCompany(await res.json())
    })
    fetch(`/api/finans/accounts?companyId=${companyId}&type=BANK`).then(async (res) => {
      if (res.ok) setBankAccounts(await res.json())
    })
  }, [companyId])

  const editable = quote && quote.status !== "CONVERTED"

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

  async function save() {
    if (!quote || !editable) return
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

    setSaving(true)
    try {
      const res = await fetch(`/api/teklif/${quote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId || null,
          currency,
          date,
          validUntil: validUntil || null,
          notes: notes || null,
          items,
        }),
      })
      if (res.ok) {
        toast({ title: "Kaydedildi" })
        await load()
      } else {
        let message = "Kaydedilemedi"
        try {
          const data = await res.json()
          if (typeof data?.error === "string") message = data.error
        } catch {
          /* ignore */
        }
        toast({ title: "Hata", description: message, variant: "destructive" })
      }
    } finally {
      setSaving(false)
    }
  }

  function handleDownloadPdf() {
    if (!quote) return
    window.open(`/api/teklif/${quote.id}/pdf`, "_blank")
  }

  async function handleConvertToInvoice() {
    if (!quote || !companyId) return
    if (!confirm("Bu teklifi faturaya dönüştürmek istediğinize emin misiniz? Bu işlem geri alınamaz.")) return
    setConverting(true)
    try {
      const res = await fetch(`/api/teklif/${quote.id}/faturaya-donustur`, { method: "POST" })
      if (!res.ok) {
        let message = "Dönüştürülemedi"
        try {
          const data = await res.json()
          if (typeof data?.error === "string") message = data.error
        } catch {
          /* ignore */
        }
        toast({ title: "Hata", description: message, variant: "destructive" })
        return
      }
      const invoice = await res.json()
      toast({ title: "Fatura oluşturuldu" })
      if (invoice?.id) {
        router.push(`/faturalar/${invoice.id}/onizleme?company=${encodeURIComponent(companyId)}`)
      } else {
        await load()
      }
    } finally {
      setConverting(false)
    }
  }

  async function handleStatusChange(next: string) {
    if (!quote || next === quote.status) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/teklif/${quote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        let message = "Güncellenemedi"
        try {
          const data = await res.json()
          if (typeof data?.error === "string") message = data.error
        } catch {
          /* ignore */
        }
        toast({ title: "Hata", description: message, variant: "destructive" })
        return
      }
      toast({ title: "Durum güncellendi" })
      await load()
    } finally {
      setUpdatingStatus(false)
    }
  }

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  const backHref = `/teklif?company=${encodeURIComponent(companyId)}`
  const companyQs = `?company=${encodeURIComponent(companyId)}`

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Yükleniyor…
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-muted-foreground">Teklif bulunamadı.</p>
        <Button variant="outline" asChild>
          <Link href={backHref}>Listeye dön</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Teklifler
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{quote.quoteNo}</h1>
        {quote.status === "CONVERTED" ? (
          <Badge variant="secondary">{statusLabel(quote.status)}</Badge>
        ) : (
          <Select
            value={quote.status}
            disabled={updatingStatus}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">Taslak</SelectItem>
              <SelectItem value="SENT">Gönderildi</SelectItem>
              <SelectItem value="APPROVED">Onaylandı</SelectItem>
              <SelectItem value="REJECTED">Reddedildi</SelectItem>
              <SelectItem value="EXPIRED">Süresi doldu</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {quote.convertedInvoiceId ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/faturalar/${quote.convertedInvoiceId}/onizleme${companyQs}`}>
                <FileText className="mr-2 h-4 w-4" />
                Faturayı aç
              </Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleConvertToInvoice}
              disabled={converting}
            >
              {converting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Faturaya Dönüştür
            </Button>
          )}
          <Button onClick={handleDownloadPdf} size="sm">
            <Download className="mr-2 h-4 w-4" />
            PDF İndir
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Firma Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {company ? (
              <>
                <p className="text-base font-semibold">{company.name}</p>
                {company.taxNumber && (
                  <p className="text-muted-foreground">
                    VKN: {company.taxNumber}
                    {company.taxOffice ? ` / ${company.taxOffice}` : ""}
                  </p>
                )}
                {company.address && (
                  <p className="text-muted-foreground">{company.address}</p>
                )}
                {company.city && (
                  <p className="text-muted-foreground">{company.city}</p>
                )}
                {company.phone && (
                  <p className="text-muted-foreground">Tel: {company.phone}</p>
                )}
                {company.email && (
                  <p className="text-muted-foreground">E-posta: {company.email}</p>
                )}
                {company.website && (
                  <p className="text-muted-foreground">{company.website}</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Firma bilgileri yükleniyor…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Landmark className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Banka Hesapları</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {bankAccounts.length === 0 ? (
              <p className="text-muted-foreground">
                Aktif banka hesabı tanımlı değil.{" "}
                <Link
                  href={`/finans?company=${encodeURIComponent(companyId)}`}
                  className="text-primary hover:underline"
                >
                  Finans hesaplarından
                </Link>{" "}
                ekleyebilirsiniz.
              </p>
            ) : (
              bankAccounts.map((acc) => (
                <div key={acc.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{acc.name}</p>
                      {acc.bankName && (
                        <p className="text-xs text-muted-foreground">{acc.bankName}</p>
                      )}
                    </div>
                    <Badge variant="outline">{acc.currency}</Badge>
                  </div>
                  {acc.iban && (
                    <p className="mt-2 font-mono text-xs">IBAN: {acc.iban}</p>
                  )}
                  {!acc.iban && acc.accountNumber && (
                    <p className="mt-2 font-mono text-xs">
                      Hesap No: {acc.accountNumber}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Teklif bilgileri</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Müşteri</Label>
              <Select value={customerId || "__none__"} disabled={!editable} onValueChange={(v) => setCustomerId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Para birimi</Label>
              <Select value={currency} disabled={!editable} onValueChange={setCurrency}>
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
            <div>
              <Label>Tarih</Label>
              <Input type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Geçerlilik</Label>
              <Input type="date" value={validUntil} disabled={!editable} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Not</Label>
            <Input value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Kalemler</CardTitle>
          {editable && (
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((l) => [...l, emptyLine()])}>
              <Plus className="mr-1 h-4 w-4" />
              Satır ekle
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editable ? (
            <div className="space-y-3">
              {lines.map((row, index) => (
                <div key={index} className="grid gap-2 border-b pb-3 last:border-0 sm:grid-cols-12">
                  <div className="sm:col-span-3">
                    <Label className="text-xs text-muted-foreground">Ürün</Label>
                    <Select
                      value={row.productId || "__none__"}
                      onValueChange={(v) => (v === "__none__" ? updateLine(index, { productId: "" }) : applyProductToLine(index, v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-4">
                    <Label className="text-xs text-muted-foreground">Açıklama</Label>
                    <Input value={row.description} onChange={(e) => updateLine(index, { description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:col-span-5 sm:grid-cols-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Miktar</Label>
                      <Input type="number" value={row.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Birim fiyat</Label>
                      <Input type="number" value={row.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">İsk. %</Label>
                      <Input type="number" value={row.discountRate} onChange={(e) => updateLine(index, { discountRate: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">KDV %</Label>
                      <Input type="number" value={row.vatRate} onChange={(e) => updateLine(index, { vatRate: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex justify-end sm:col-span-12">
                    <Button type="button" variant="ghost" size="icon" disabled={lines.length <= 1} onClick={() => setLines((l) => l.filter((_, i) => i !== index))}>
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Kaydet
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Açıklama</TableHead>
                  <TableHead className="text-right">Miktar</TableHead>
                  <TableHead className="text-right">Birim</TableHead>
                  <TableHead className="text-right">KDV %</TableHead>
                  <TableHead className="text-right">Satır toplamı</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.items.map((it) => (
                  <TableRow key={it.id || it.description}>
                    <TableCell>{it.description}</TableCell>
                    <TableCell className="text-right">{Number(it.quantity).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{Number(it.unitPrice).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{Number(it.vatRate).toFixed(0)}</TableCell>
                    <TableCell className="text-right">{Number((it as any).totalAmount ?? 0).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap gap-6 pt-6 text-sm">
          <div>
            <span className="text-muted-foreground">Net</span>
            <div className="font-semibold">{Number(quote.netAmount).toFixed(2)} {quote.currency}</div>
          </div>
          <div>
            <span className="text-muted-foreground">KDV</span>
            <div className="font-semibold">{Number(quote.vatAmount).toFixed(2)} {quote.currency}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Genel toplam</span>
            <div className="text-lg font-bold">{Number(quote.totalAmount).toFixed(2)} {quote.currency}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
