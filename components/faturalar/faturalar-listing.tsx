"use client"

import { useEffect, useState, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
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
} from "@/components/ui/styled-table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  Eye,
  FileText,
  FileDown,
  Inbox,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { filenameFromContentDisposition } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface FaturaRow {
  id: string
  slug: string | null
  direction: "incoming" | "outgoing"
  source: "mysoft_inbox" | "manual_purchase" | "manual_sales" | "converted_inbox"
  date: string | null
  createdAt: string | null
  invoiceNo: string | null
  uuid: string | null
  counterparty: { name: string | null; taxNumber: string | null }
  currency: string | null
  netAmount: number | null
  vatAmount: number | null
  totalAmount: number | null
  status: string | null
  profile: string | null
  invoiceType: string | null
  meta: Record<string, any>
}

interface Totals {
  all: { count: number; sum: number }
  incoming: { count: number; sum: number }
  outgoing: { count: number; sum: number }
}

interface Company {
  id: string
  slug?: string
  isEDonusumEnabled?: boolean
}

const directionTabs = [
  { value: "all" as const, label: "Hepsi", icon: FileText },
  { value: "incoming" as const, label: "Gelen", icon: ArrowDownToLine },
  { value: "outgoing" as const, label: "Giden", icon: ArrowUpFromLine },
]

function resolveInitialDirection(
  searchParams: URLSearchParams,
): "all" | "incoming" | "outgoing" {
  const dir = searchParams.get("direction")
  if (dir === "incoming" || dir === "outgoing" || dir === "all") return dir
  const type = searchParams.get("type")
  if (type === "SALES") return "outgoing"
  if (type === "PURCHASE") return "incoming"
  return "all"
}

export interface FaturalarListingProps {
  fixedDirection?: "incoming" | "outgoing"
  pageTitle?: string
  pageDescription?: string
  includeInbox?: boolean
}

export default function FaturalarListing({
  fixedDirection,
  pageTitle,
  pageDescription,
  includeInbox = true,
}: FaturalarListingProps = {}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [rows, setRows] = useState<FaturaRow[]>([])
  const [totals, setTotals] = useState<Totals>({
    all: { count: 0, sum: 0 },
    incoming: { count: 0, sum: 0 },
    outgoing: { count: 0, sum: 0 },
  })
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [direction, setDirection] = useState<"all" | "incoming" | "outgoing">(() =>
    fixedDirection ?? resolveInitialDirection(searchParams),
  )

  useEffect(() => {
    setDirection(fixedDirection ?? resolveInitialDirection(searchParams))
  }, [searchParams, fixedDirection])
  const [days, setDays] = useState(90)
  const [search, setSearch] = useState("")
  const [checkingStatusId, setCheckingStatusId] = useState<string | null>(null)
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null)
  const [downloadingInboxPdfUuid, setDownloadingInboxPdfUuid] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isDeletingRow, setIsDeletingRow] = useState(false)

  const fetchCompany = useCallback(async () => {
    if (!companyId) return
    try {
      const response = await fetch("/api/companies")
      if (!response.ok) return
      const companies = (await response.json()) as Company[]
      setCompany(companies.find((item) => item.id === companyId || item.slug === companyId) || null)
    } catch {
      // ignore
    }
  }, [companyId])

  const fetchList = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        direction,
        days: String(days),
      })
      if (!includeInbox) params.set("includeInbox", "false")
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`/api/faturalar?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Faturalar yüklenemedi",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        setRows([])
        return
      }
      setRows(data.data || [])
      setTotals(data.totals || totals)
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Liste yüklenirken hata",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, direction, days, search, includeInbox, toast])

  useEffect(() => {
    fetchCompany()
  }, [fetchCompany])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const handleSyncInbox = async () => {
    if (!companyId) return
    setIsSyncing(true)
    try {
      const res = await fetch("/api/e-donusum/inbox/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, days }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Senkronizasyon başarısız",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      toast({
        title: "Mysoft Inbox senkronize edildi",
        description: `${data.fetched} kayıt · ${data.inserted} yeni · ${data.updated} güncel`,
      })
      await fetchList()
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Sync sırasında hata",
        variant: "destructive",
      })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleCreateInvoice = () => {
    if (!companyId) return
    const backPath =
      fixedDirection === "incoming"
        ? "/alis/fatura"
        : "/satis/fatura"
    const fromParam = `&from=${encodeURIComponent(backPath)}`
    // Alış faturaları sayfasından "Yeni Fatura" → fatura tipi varsayılan PURCHASE,
    // satış sayfasından → SALES gelsin. Aksi halde editör her zaman SALES açılıyordu.
    const typeParam =
      fixedDirection === "incoming"
        ? "&type=PURCHASE"
        : fixedDirection === "outgoing"
          ? "&type=SALES"
          : ""
    const target = company?.isEDonusumEnabled
      ? `/e-donusum/yeni?company=${encodeURIComponent(companyId)}${fromParam}${typeParam}`
      : `/e-donusum/yeni?company=${encodeURIComponent(companyId)}&manual=1${fromParam}${typeParam}`
    router.push(target)
  }

  const confirmDeleteInvoice = async () => {
    const rawInvoiceId = deleteTargetId
    if (!rawInvoiceId) return
    setIsDeletingRow(true)
    try {
      const res = await fetch(
        `/api/e-donusum/invoices/${rawInvoiceId}?companyId=${companyId}`,
        { method: "DELETE" },
      )
      if (res.ok) {
        // Anında geri bildirim: satırı listeden hemen kaldır, sonra arka planda
        // listeyi tazele (toplamlar/bakiye güncellensin).
        setRows((prev) => prev.filter((row) => row.id !== rawInvoiceId))
        toast({ title: "Başarılı", description: "Fatura silindi." })
        setDeleteTargetId(null)
        fetchList()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "Silinemedi",
          description: data.error || "Fatura silinemedi",
          variant: "destructive",
        })
      }
    } catch {
      toast({
        title: "Hata",
        description: "Silme işlemi sırasında bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsDeletingRow(false)
    }
  }

  const handleCheckStatus = async (rawInvoiceId: string) => {
    setCheckingStatusId(rawInvoiceId)
    try {
      const res = await fetch(`/api/e-donusum/invoices/${rawInvoiceId}/check-status`, {
        method: "POST",
      })
      const data = await res.json()
      if (res.ok) {
        toast({
          title: `Durum: ${data.message}`,
          description: data.rawText ? `Mysoft kodu: ${data.rawText}` : undefined,
        })
        fetchList()
      } else {
        toast({
          title: "Sorgulanamadı",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
      }
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Durum sorgulanamadı",
        variant: "destructive",
      })
    } finally {
      setCheckingStatusId(null)
    }
  }

  const handleDownloadIncomingPdf = async (uuid: string, invoiceNo: string | null) => {
    if (!companyId || !uuid) return
    setDownloadingInboxPdfUuid(uuid)
    try {
      const res = await fetch(
        `/api/e-donusum/inbox/${encodeURIComponent(uuid)}/pdf?companyId=${encodeURIComponent(
          companyId,
        )}`,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "PDF indirilemedi",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      toast({ title: `PDF açıldı${invoiceNo ? ` · ${invoiceNo}` : ""}` })
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "PDF açılırken hata oluştu",
        variant: "destructive",
      })
    } finally {
      setDownloadingInboxPdfUuid(null)
    }
  }

  const handleDownloadGibPdf = async (rawInvoiceId: string, invoiceNo: string) => {
    setDownloadingPdfId(rawInvoiceId)
    try {
      const res = await fetch(`/api/e-donusum/invoices/${rawInvoiceId}/pdf`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "PDF indirilemedi",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filenameFromContentDisposition(res.headers.get("Content-Disposition")) || `${invoiceNo}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: "Resmî PDF indirildi" })
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "PDF indirilirken hata oluştu",
        variant: "destructive",
      })
    } finally {
      setDownloadingPdfId(null)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{pageTitle ?? "Faturalar"}</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const fmt = (v: number | null | undefined, ccy = "TRY") =>
    v === null || v === undefined
      ? "-"
      : new Intl.NumberFormat("tr-TR", { style: "currency", currency: ccy }).format(Number(v))

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("tr-TR") : "-"

  const formatTime = (d: string | null) =>
    d
      ? new Date(d).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
      : null

  const directionBadge = (row: FaturaRow) => {
    if (row.direction === "incoming") {
      return (
        <span className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">
          <ArrowDownToLine className="mr-1 h-3 w-3" />
          Gelen
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200">
        <ArrowUpFromLine className="mr-1 h-3 w-3" />
        Giden
      </span>
    )
  }

  const statusBadge = (status: string | null) => {
    if (!status) return <span className="text-xs text-muted-foreground">-</span>
    const s = status.toUpperCase()
    const cls =
      s === "KABUL" || s === "APPROVED" || s === "SENT"
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
        : s === "RED" || s === "REJECTED" || s === "CANCELLED"
          ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200"
          : s === "GIB_DRAFT"
            ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200"
            : s === "DRAFT"
              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-200"
              : "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200"
    // GİB taslağı ham "GIB_DRAFT" yerine okunur etiket göster.
    const label = s === "GIB_DRAFT" ? "GİB Taslağı" : status
    return <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>
  }

  const resolvedTitle = pageTitle ?? "Faturalar"
  const resolvedDescription =
    pageDescription ?? "Tüm gelen ve giden faturalarınızı tek ekrandan yönetin"

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div>
          <h1 className="text-3xl font-bold">{resolvedTitle}</h1>
          <p className="text-muted-foreground">{resolvedDescription}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={isLoading || isSyncing}
          >
            <option value={30}>Son 30 gün</option>
            <option value={90}>Son 90 gün</option>
            <option value={180}>Son 6 ay</option>
            <option value={365}>Son 1 yıl</option>
          </select>
          {fixedDirection !== "outgoing" && includeInbox && (
            <Button
              variant="outline"
              onClick={handleSyncInbox}
              disabled={isSyncing}
              title="Mysoft InvoiceInbox'tan gelen e-faturaları çek"
            >
              {isSyncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Inbox className="mr-2 h-4 w-4" />
              )}
              Mysoft Inbox Senkronize
            </Button>
          )}
          <Button variant="outline" onClick={fetchList} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Yenile
          </Button>
          <Button onClick={handleCreateInvoice}>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Fatura
          </Button>
        </div>
      </div>

      {!fixedDirection && (
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <p className="text-xs text-muted-foreground">Toplam</p>
                <p className="text-2xl font-bold">{totals.all.count}</p>
                <p className="text-xs text-muted-foreground">{fmt(totals.all.sum)}</p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground/30" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <p className="text-xs text-muted-foreground">Gelen</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                  {totals.incoming.count}
                </p>
                <p className="text-xs text-muted-foreground">{fmt(totals.incoming.sum)}</p>
              </div>
              <ArrowDownToLine className="h-8 w-8 text-emerald-300 dark:text-emerald-500/70" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <p className="text-xs text-muted-foreground">Giden</p>
                <p className="text-2xl font-bold text-sky-700 dark:text-sky-300">
                  {totals.outgoing.count}
                </p>
                <p className="text-xs text-muted-foreground">{fmt(totals.outgoing.sum)}</p>
              </div>
              <ArrowUpFromLine className="h-8 w-8 text-sky-300 dark:text-sky-500/70" />
            </CardContent>
          </Card>
        </div>
      )}

      {fixedDirection && (
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs text-muted-foreground">Toplam</p>
              <p className="text-2xl font-bold">
                {fixedDirection === "incoming" ? totals.incoming.count : totals.outgoing.count}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmt(
                  fixedDirection === "incoming" ? totals.incoming.sum : totals.outgoing.sum,
                )}
              </p>
            </div>
            {fixedDirection === "incoming" ? (
              <ArrowDownToLine className="h-8 w-8 text-emerald-300 dark:text-emerald-500/70" />
            ) : (
              <ArrowUpFromLine className="h-8 w-8 text-sky-300 dark:text-sky-500/70" />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            {!fixedDirection &&
              directionTabs.map((tab) => {
                const Icon = tab.icon
                const active = direction === tab.value
                return (
                  <Button
                    key={tab.value}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDirection(tab.value)}
                  >
                    <Icon className="mr-1 h-3 w-3" />
                    {tab.label}
                  </Button>
                )
              })}
            <div className="relative ml-auto flex-1 max-w-md">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Fatura no / karşı taraf / VKN / ETTN ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                {!fixedDirection && <StyledTableHead>Yön</StyledTableHead>}
                <StyledTableHead>Tarih</StyledTableHead>
                <StyledTableHead>Fatura No</StyledTableHead>
                <StyledTableHead>VKN</StyledTableHead>
                <StyledTableHead>
                  {fixedDirection === "incoming"
                    ? "Tedarikçi"
                    : fixedDirection === "outgoing"
                      ? "Müşteri"
                      : "Karşı Taraf"}
                </StyledTableHead>
                {!fixedDirection && <StyledTableHead>Profil</StyledTableHead>}
                <StyledTableHead>Tip</StyledTableHead>
                {fixedDirection !== "outgoing" && <StyledTableHead>Kaynak</StyledTableHead>}
                {!fixedDirection && <StyledTableHead className="text-right">Net</StyledTableHead>}
                {!fixedDirection && <StyledTableHead className="text-right">KDV</StyledTableHead>}
                <StyledTableHead className="text-right">Toplam</StyledTableHead>
                <StyledTableHead>Durum</StyledTableHead>
                <StyledTableHead className="text-right">İşlem</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={fixedDirection === "incoming" ? 9 : fixedDirection === "outgoing" ? 8 : 13} className="py-8 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={fixedDirection === "incoming" ? 9 : fixedDirection === "outgoing" ? 8 : 13} className="py-8 text-center">
                    <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Bu kriterlere uyan fatura bulunamadı</p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => {
                  const rawId = row.id.split(":")[1]
                  const isInvoiceRow = row.id.startsWith("invoice:")
                  const isEDoc =
                    row.invoiceType === "E_INVOICE" || row.invoiceType === "E_ARCHIVE"
                  // GİB durumu sorgulama / resmî PDF yalnızca kesinleşmiş (SENT) belgede;
                  // GİB taslağında uuid dolu olsa da belge henüz GİB'de değil.
                  const canCheckGib = Boolean(isInvoiceRow && row.status === "SENT" && isEDoc)
                  const canDownloadGibPdf = canCheckGib
                  const editable = isInvoiceRow && row.status === "DRAFT"

                  return (
                    <StyledTableRow
                      key={row.id}
                      index={idx}
                      className="cursor-pointer"
                      onClick={() => {
                        if (isInvoiceRow) {
                          router.push(`/faturalar/${row.slug || rawId}/onizleme?company=${companyId}`)
                        }
                      }}
                    >
                      {!fixedDirection && <TableCell>{directionBadge(row)}</TableCell>}
                      <TableCell className="text-xs whitespace-nowrap">
                        <div>{formatDate(row.date)}</div>
                        {formatTime(row.createdAt) && (
                          <div className="text-[11px] text-muted-foreground">{formatTime(row.createdAt)}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium text-kobipo-blue dark:text-kobipo-mid">
                        {row.invoiceNo || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.counterparty.taxNumber || "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                          <span
                            className="truncate max-w-[260px]"
                            title={row.counterparty.name || ""}
                          >
                            {row.counterparty.name || "-"}
                          </span>
                        </div>
                      </TableCell>
                      {!fixedDirection && (
                        <TableCell><ProfileBadge profile={row.profile} /></TableCell>
                      )}
                      <TableCell><InvoiceTypeBadge type={row.invoiceType} /></TableCell>
                      {fixedDirection !== "outgoing" && (
                        <TableCell><SourceBadge row={row} /></TableCell>
                      )}
                      {!fixedDirection && (
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          {fmt(row.netAmount, row.currency || "TRY")}
                        </TableCell>
                      )}
                      {!fixedDirection && (
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          {fmt(row.vatAmount, row.currency || "TRY")}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-xs font-semibold whitespace-nowrap">
                        {fmt(row.totalAmount, row.currency || "TRY")}
                      </TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isInvoiceRow ? (
                            <>
                              <Link
                                href={`/faturalar/${row.slug || rawId}/onizleme?company=${companyId}`}
                              >
                                <Button variant="outline" size="sm" title="Önizleme">
                                  <FileText className="h-4 w-4" />
                                </Button>
                              </Link>
                              <Link
                                href={`/faturalar/${rawId}/odemeler?company=${companyId}`}
                              >
                                <Button variant="outline" size="sm" title="Ödemeler">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                              {editable && (
                                <Link
                                  href={`/e-donusum/${rawId}/duzenle?company=${encodeURIComponent(
                                    companyId,
                                  )}&from=${encodeURIComponent(
                                    fixedDirection === "incoming" ? "/alis/fatura" : "/satis/fatura",
                                  )}`}
                                >
                                  <Button variant="outline" size="sm" title="Düzenle">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </Link>
                              )}
                              {canCheckGib && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  title="GİB Durum Sorgula"
                                  onClick={() => handleCheckStatus(rawId)}
                                  disabled={checkingStatusId === rawId}
                                >
                                  {checkingStatusId === rawId ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <ShieldCheck className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                              {canDownloadGibPdf && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  title="Resmî PDF (GİB) İndir"
                                  onClick={() =>
                                    handleDownloadGibPdf(rawId, row.invoiceNo || "fatura")
                                  }
                                  disabled={downloadingPdfId === rawId}
                                >
                                  {downloadingPdfId === rawId ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <FileDown className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                title="Sil / İptal Et"
                                onClick={() => setDeleteTargetId(rawId)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          ) : (
                            <>
                              {row.uuid && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  title="Resmî PDF (GİB) görüntüle"
                                  onClick={() =>
                                    handleDownloadIncomingPdf(row.uuid as string, row.invoiceNo)
                                  }
                                  disabled={downloadingInboxPdfUuid === row.uuid}
                                >
                                  {downloadingInboxPdfUuid === row.uuid ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <FileDown className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                              <span
                                className="text-[10px] text-muted-foreground"
                                title={row.uuid || ""}
                              >
                                Mysoft
                              </span>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </StyledTableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          </StyledTableContainer>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null)
        }}
        title="Faturayı sil"
        description={(() => {
          const target = rows.find((r) => r.id === deleteTargetId)
          // "GİB'e gönderilmiş" uyarısı yalnızca kesinleşmiş belgede; GİB taslağında
          // (uuid dolu ama status GIB_DRAFT) belge GİB'e gitmediğinden normal silme uyarısı.
          const sentToGib = !!target && target.status === "SENT"
          return sentToGib ? (
            <>
              Bu fatura <strong>GİB&apos;e gönderilmiş</strong> (e-Fatura/e-Arşiv). Silme işlemi{" "}
              <strong>GİB&apos;deki e-faturanızı İPTAL ETMEZ</strong>; belge GİB&apos;de geçerli
              kalır. Yalnızca Kobipo&apos;daki (cari) kaydınızdan siler — stok ve cari bakiye geri
              alınır ve bu işlem geri alınamaz. Yine de yalnızca cari kayıtlarınızdan silmek
              istiyor musunuz?
            </>
          ) : (
            "Bu faturayı silmek istediğinize emin misiniz? Bu işlem stokları ve cari bakiyeleri geri alır. Geri alınamaz."
          )
        })()}
        confirmLabel="Sil"
        variant="destructive"
        isProcessing={isDeletingRow}
        onConfirm={confirmDeleteInvoice}
      />
    </div>
  )
}

const BADGE_TONES = {
  sky: "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40",
  cyan: "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-cyan-500/40",
  indigo:
    "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-500/40",
  slate:
    "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/40",
  purple:
    "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/40",
  red: "bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-300 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/40",
  amber:
    "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40",
  blue: "bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/40",
} as const

function ProfileBadge({ profile }: { profile: string | null }) {
  if (!profile) return <span className="text-xs text-muted-foreground">-</span>
  const map: Record<string, { label: string; cls: string }> = {
    TICARIFATURA: { label: "Ticari", cls: BADGE_TONES.indigo },
    TEMELFATURA: { label: "Temel", cls: BADGE_TONES.slate },
    EARSIVFATURA: { label: "E-Arşiv", cls: BADGE_TONES.cyan },
    EFATURA: { label: "E-Fatura", cls: BADGE_TONES.sky },
  }
  const entry = map[profile] || { label: profile, cls: BADGE_TONES.slate }
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${entry.cls}`}
    >
      {entry.label}
    </span>
  )
}

function InvoiceTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-muted-foreground">-</span>
  const map: Record<string, { label: string; cls: string }> = {
    E_INVOICE: { label: "E-Fatura", cls: BADGE_TONES.sky },
    E_ARCHIVE: { label: "E-Arşiv", cls: BADGE_TONES.cyan },
    SATIS: { label: "Satış", cls: BADGE_TONES.sky },
    TEVKIFAT: { label: "Tevkifat", cls: BADGE_TONES.purple },
    IADE: { label: "İade", cls: BADGE_TONES.red },
    ISTISNA: { label: "İstisna", cls: BADGE_TONES.amber },
    OZELMATRAH: { label: "Özel Matrah", cls: BADGE_TONES.cyan },
    IHRACAT: { label: "İhracat", cls: BADGE_TONES.blue },
  }
  const entry = map[type] || { label: type, cls: BADGE_TONES.slate }
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${entry.cls}`}
    >
      {entry.label}
    </span>
  )
}

function SourceBadge({ row }: { row: FaturaRow }) {
  if (row.source === "converted_inbox" || row.meta?.convertedFromInbox) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium ${BADGE_TONES.sky}`}
        title="Gelen e-faturadan dönüştürülmüş alış faturası"
      >
        <Link2 className="h-3 w-3" />
        E-Fatura Dönüşümü
      </span>
    )
  }
  if (row.source === "mysoft_inbox") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium ${BADGE_TONES.amber}`}
      >
        <Inbox className="h-3 w-3" />
        Gelen Kutusu
      </span>
    )
  }
  if (row.source === "manual_sales") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium ${BADGE_TONES.sky}`}
      >
        Satış
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium ${BADGE_TONES.slate}`}
    >
      Manuel
    </span>
  )
}
