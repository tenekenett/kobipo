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
import { SearchSelect } from "@/components/ui/search-select"
import { QuickCariDialog, useCanCreateCari } from "@/components/e-donusum/quick-cari-dialog"
import {
  QuoteLinesEditor,
  QuoteTotalsSummary,
  emptyGlobalDiscount,
  emptyQuoteLine,
  globalDiscountFromQuote,
  globalDiscountPayload,
  quoteLineFromItem,
  quoteLinePayload,
  type QuoteGlobalDiscount,
  type QuoteLine,
  type QuoteProduct,
} from "@/components/teklif/quote-lines"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { ExportAction, WriteAction, useCanEditHere } from "@/components/dashboard/write-guard"
import { ArrowLeft, Building2, Download, FileText, Landmark, Loader2, Save } from "lucide-react"
import { looksLikeCuid } from "@/lib/slug"
import { toDateInput } from "@/lib/format"

type QuoteItem = {
  id?: string
  productId?: string | null
  description: string
  note?: string | null
  quantity: number
  unitPrice: number
  vatRate: number
  discountRate?: number | null
  discountAmount?: number | null
  totalAmount?: number | null
  product?: { id: string; name: string } | null
}

type QuoteParty = {
  id: string
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
}

type QuoteDetail = {
  id: string
  slug?: string
  companyId: string
  quoteNo: string
  status: string
  date: string
  validUntil?: string | null
  currency: string
  notes?: string | null
  customerId?: string | null
  supplierId?: string | null
  netAmount: number
  vatAmount: number
  totalAmount: number
  globalDiscountRate?: number | null
  globalDiscountAmount?: number | null
  convertedInvoiceId?: string | null
  customer?: QuoteParty | null
  supplier?: QuoteParty | null
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
  const { confirm } = useConfirm()

  const [quote, setQuote] = useState<QuoteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  // Teklif SATIŞ (müşterili) ya da SATIN ALMA (tedarikçili) olabilir; ekran aynı
  // sayfadır, yalnız taraf ekseni değişir. Hangi eksende olduğumuzu kaydın
  // kendisi söyler (supplierId doluysa satın alma).
  const [isPurchase, setIsPurchase] = useState(false)
  const [parties, setParties] = useState<Array<{ id: string; name: string }>>([])
  // Müşteri listede yoksa buradan eklenir; seçiciye yazılan ad forma taşınır.
  // Cari kartı yazma yetkisi yoksa "Yeni cari ekle" seçeneği hiç çizilmez
  // (sunucu kapısı da aynı sahipliği uygular: lib/page-access.ts → /api/cari/*).
  const canCreateCari = useCanCreateCari().customer
  const [quickCari, setQuickCari] = useState({ open: false, name: "" })
  const [products, setProducts] = useState<QuoteProduct[]>([])
  const [company, setCompany] = useState<CompanyInfo | null>(null)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

  const [partyId, setPartyId] = useState("")
  const [currency, setCurrency] = useState("TRY")
  const [date, setDate] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<QuoteLine[]>([emptyQuoteLine()])
  const [globalDiscount, setGlobalDiscount] = useState<QuoteGlobalDiscount>(emptyGlobalDiscount)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/teklif/${id}${companyId ? `?companyId=${companyId}` : ""}`)
      if (!res.ok) {
        toast({ title: "Hata", description: "Teklif yüklenemedi", variant: "destructive" })
        setQuote(null)
        return
      }
      const data = (await res.json()) as QuoteDetail
      setQuote(data)
      // SEF: eski cuid URL ile gelindiyse okunabilir slug URL'ine sessizce yükselt.
      if (data?.slug && looksLikeCuid(String(id))) {
        router.replace(`/teklif/${data.slug}?company=${companyId}`)
      }
      setIsPurchase(Boolean(data.supplierId))
      setPartyId(data.supplierId || data.customerId || "")
      setCurrency(data.currency || "TRY")
      setDate(data.date ? toDateInput(new Date(data.date)) : "")
      setValidUntil(data.validUntil ? toDateInput(new Date(data.validUntil)) : "")
      setNotes(data.notes || "")
      setLines(data.items?.length ? data.items.map(quoteLineFromItem) : [emptyQuoteLine()])
      setGlobalDiscount(globalDiscountFromQuote(data))
    } finally {
      setLoading(false)
    }
  }, [id, companyId, router, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!companyId) return
    const endpoint = isPurchase ? "suppliers" : "customers"
    fetch(`/api/cari/${endpoint}?companyId=${companyId}`).then(async (res) => {
      if (res.ok) setParties(await res.json())
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
  }, [companyId, isPurchase])

  // Salt-okunur yetki `editable`ı da kapatır: form alanları, satır düzenleyici ve
  // Kaydet zaten bu bayrağa bağlı, dolayısıyla teklif okunur tabloya düşer.
  const canEdit = useCanEditHere()
  const editable = quote && quote.status !== "CONVERTED" && canEdit

  async function save() {
    if (!quote || !editable) return
    const items = lines.map(quoteLinePayload).filter((row) => row.description.length > 0)

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
          ...(isPurchase
            ? { supplierId: partyId || null }
            : { customerId: partyId || null }),
          currency,
          date,
          validUntil: validUntil || null,
          notes: notes || null,
          items,
          globalDiscount: globalDiscountPayload(globalDiscount),
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
    if (!(await confirm({ title: "Faturaya dönüştür", description: "Bu teklifi faturaya dönüştürmek istediğinize emin misiniz? Bu işlem geri alınamaz.", confirmLabel: "Dönüştür" }))) return
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

  const backHref = `${isPurchase ? "/alis/teklif" : "/teklif"}?company=${encodeURIComponent(companyId)}`
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
          <WriteAction fallback={<Badge variant="secondary">{statusLabel(quote.status)}</Badge>}>
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
          </WriteAction>
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
            <WriteAction>
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
            </WriteAction>
          )}
          <ExportAction>
            <Button onClick={handleDownloadPdf} size="sm">
              <Download className="mr-2 h-4 w-4" />
              PDF İndir
            </Button>
          </ExportAction>
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
              <Label>{isPurchase ? "Tedarikçi" : "Müşteri"}</Label>
              <SearchSelect
                options={parties}
                value={partyId}
                onChange={(v) => setPartyId(v)}
                placeholder={isPurchase ? "Tedarikçi seçin veya arayın…" : "Müşteri seçin veya arayın…"}
                disabled={!editable}
                allowClear
                onCreate={editable && canCreateCari ? (name) => setQuickCari({ open: true, name }) : undefined}
                createLabel={isPurchase ? "Yeni tedarikçi ekle" : "Yeni müşteri ekle"}
              />
              {companyId && (
                <QuickCariDialog
                  open={quickCari.open}
                  onOpenChange={(open) => setQuickCari((prev) => ({ ...prev, open }))}
                  companyId={companyId}
                  defaultKind={isPurchase ? "supplier" : "customer"}
                  initialName={quickCari.name}
                  requireTaxFields={false}
                  onCreated={(created, kind) => {
                    const expected = isPurchase ? "supplier" : "customer"
                    if (kind !== expected) {
                      toast({
                        title: isPurchase ? "Müşteri olarak kaydedildi" : "Tedarikçi olarak kaydedildi",
                        description: `${isPurchase ? "Tedarikçi" : "Müşteri"} listesine eklenmedi, seçim yapılmadı.`,
                      })
                      return
                    }
                    setParties((prev) =>
                      prev.some((c) => c.id === created.id)
                        ? prev
                        : [...prev, { id: created.id, name: created.name }]
                    )
                    setPartyId(created.id)
                  }}
                />
              )}
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
            <Button onClick={save} variant="success" size="sm" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Kaydet
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editable ? (
            <div className="space-y-3">
              {/* Oluşturma penceresiyle AYNI düzenleyici: satır/genel iskonto modu,
                  referans fiyat ve tutar hücresi burada da çalışır. */}
              <QuoteLinesEditor
                lines={lines}
                onChange={setLines}
                products={products}
                onProductsChange={(updater) => setProducts(updater)}
                companyId={companyId}
                currency={currency}
                priceMode={isPurchase ? "purchase" : "sale"}
                hideLabel
              />
              <QuoteTotalsSummary
                lines={lines}
                currency={currency}
                globalDiscount={globalDiscount}
                onGlobalDiscountChange={setGlobalDiscount}
              />
              <div className="flex justify-end">
                <Button onClick={save} variant="success" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Kaydet
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Açıklama</TableHead>
                    <TableHead className="text-right">Miktar</TableHead>
                    <TableHead className="text-right">Birim</TableHead>
                    <TableHead className="text-right">İskonto</TableHead>
                    <TableHead className="text-right">KDV %</TableHead>
                    <TableHead className="text-right">Satır toplamı</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.items.map((it) => {
                    const discountAmount = Number(it.discountAmount || 0)
                    const discountRate = Number(it.discountRate || 0)
                    return (
                      <TableRow key={it.id || it.description}>
                        <TableCell>
                          <div>{it.description}</div>
                          {it.note && (
                            <div className="whitespace-pre-line text-xs text-muted-foreground">{it.note}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{Number(it.quantity).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{Number(it.unitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {discountAmount > 0 ? (
                            <>
                              -{discountAmount.toFixed(2)}
                              {discountRate > 0 && (
                                <div className="text-xs text-muted-foreground">%{discountRate.toLocaleString("tr-TR")}</div>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right">{Number(it.vatRate).toFixed(0)}</TableCell>
                        <TableCell className="text-right">{Number(it.totalAmount ?? 0).toFixed(2)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <QuoteTotalsSummary lines={lines} currency={currency} globalDiscount={globalDiscount} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
