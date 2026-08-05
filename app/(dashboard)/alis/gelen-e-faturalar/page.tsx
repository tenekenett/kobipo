"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import {
  Download,
  Loader2,
  RefreshCw,
  Inbox,
  Search,
  FileDown,
  CheckCircle2,
  XCircle,
  Clock,
  Link2,
  Building2,
  Hash,
} from "lucide-react"
import { Input } from "@/components/ui/input"

interface IncomingRow {
  id: string
  uuid: string
  invoiceNo: string | null
  date: string | null
  sentDate: string | null
  sender: { name: string | null; taxNumber: string | null }
  profile: string | null
  invoiceType: string | null
  currency: string | null
  taxExclusiveAmount: string | number | null
  vatAmount: string | number | null
  totalAmount: string | number | null
  status: string | null
  envelopeStatusDesc: string | null
  isArchived: boolean
  isLinkedToPurchase: boolean
  linkedInvoiceId: string | null
  syncedAt: string
}

const fmtCurrency = (v: string | number | null, ccy = "TRY") =>
  v === null || v === undefined
    ? "-"
    : new Intl.NumberFormat("tr-TR", { style: "currency", currency: ccy }).format(Number(v))

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("tr-TR") : "-"

// Saati yalnızca anlamlıysa (gece yarısı 00:00 değilse) döndür — Mysoft fatura
// tarihini çoğu zaman saatsiz (00:00) gönderir; o durumda saat satırı gizlenir.
const fmtTimeIfMeaningful = (d: string | null) => {
  if (!d) return null
  const dt = new Date(d)
  if (dt.getHours() === 0 && dt.getMinutes() === 0) return null
  return dt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
}

const fmtDateTime = (d: string | null) =>
  d
    ? new Date(d).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-"

export default function GelenEFaturalarPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm, prompt } = useConfirm()

  const [rows, setRows] = useState<IncomingRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [profileFilter, setProfileFilter] = useState<string>("")
  const [linkFilter, setLinkFilter] = useState<string>("")
  const [downloadingPdfUuid, setDownloadingPdfUuid] = useState<string | null>(null)
  const [respondingUuid, setRespondingUuid] = useState<string | null>(null)

  const fetchList = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        days: String(days),
        source: "db",
      })
      if (statusFilter) params.set("status", statusFilter)
      const res = await fetch(`/api/e-donusum/inbox?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Liste alınamadı",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      setRows(data.data || [])
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Liste yüklenirken hata",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [companyId, days, statusFilter, toast])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const handleDownloadPdf = async (uuid: string, invoiceNo: string | null) => {
    if (!companyId) return
    setDownloadingPdfUuid(uuid)
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
      setDownloadingPdfUuid(null)
    }
  }

  const handleRespond = async (
    uuid: string,
    action: "accept" | "reject",
    invoiceNo: string | null,
  ) => {
    if (!companyId) return
    let rejectReason = ""
    if (action === "reject") {
      const input = await prompt({
        title: "Faturayı reddet",
        description: `Bu faturayı reddetmek istediğinize emin misiniz? Yanıt GİB'e iletilir.${invoiceNo ? ` (${invoiceNo})` : ""}`,
        label: "Red nedeni (en az 3 karakter)",
        placeholder: "Örn. Hatalı düzenlenmiş",
        minLength: 3,
        confirmLabel: "Reddet",
        variant: "destructive",
      })
      if (input === null) return
      rejectReason = input.trim()
      if (rejectReason.length < 3) {
        toast({ title: "Red nedeni en az 3 karakter olmalı", variant: "destructive" })
        return
      }
    } else if (!(await confirm({ title: "Faturayı kabul et", description: `Bu faturayı KABUL etmek istediğinize emin misiniz?${invoiceNo ? ` (${invoiceNo})` : ""}`, confirmLabel: "Kabul et" }))) {
      return
    }
    setRespondingUuid(uuid)
    try {
      const res = await fetch(`/api/e-donusum/inbox/${encodeURIComponent(uuid)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, action, rejectReason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: action === "accept" ? "Kabul başarısız" : "Red başarısız",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      toast({
        title: action === "accept" ? "Fatura kabul edildi" : "Fatura reddedildi",
        description: data.message || undefined,
      })
      // Yerel satırı anında güncelle, sonra listeyi tazele.
      setRows((prev) =>
        prev.map((r) => (r.uuid === uuid ? { ...r, status: action === "accept" ? "KABUL" : "RED" } : r)),
      )
      await fetchList()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "İşlem sırasında hata", variant: "destructive" })
    } finally {
      setRespondingUuid(null)
    }
  }

  const handleSync = async () => {
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
        title: "Senkronize edildi",
        description: `Toplam ${data.fetched} kayıt · ${data.inserted} yeni · ${data.updated} güncellendi${
          data.errors?.length ? ` · ${data.errors.length} hata` : ""
        }`,
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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const hit =
          (r.invoiceNo || "").toLowerCase().includes(q) ||
          (r.sender.name || "").toLowerCase().includes(q) ||
          (r.sender.taxNumber || "").toLowerCase().includes(q) ||
          (r.uuid || "").toLowerCase().includes(q)
        if (!hit) return false
      }
      if (profileFilter && r.profile !== profileFilter) return false
      if (linkFilter === "linked" && !r.isLinkedToPurchase) return false
      if (linkFilter === "unlinked" && r.isLinkedToPurchase) return false
      return true
    })
  }, [rows, search, profileFilter, linkFilter])

  const stats = useMemo(() => {
    const acc = {
      total: { count: rows.length, sum: 0 },
      accepted: { count: 0, sum: 0 },
      rejected: { count: 0, sum: 0 },
      pending: { count: 0, sum: 0 },
      linked: { count: 0, sum: 0 },
    }
    for (const r of rows) {
      const total = Number(r.totalAmount || 0)
      acc.total.sum += total
      if (r.status === "KABUL") {
        acc.accepted.count++
        acc.accepted.sum += total
      } else if (r.status === "RED") {
        acc.rejected.count++
        acc.rejected.sum += total
      } else {
        acc.pending.count++
        acc.pending.sum += total
      }
      if (r.isLinkedToPurchase) {
        acc.linked.count++
        acc.linked.sum += total
      }
    }
    return acc
  }, [rows])

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const fmtSum = (v: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(v)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Inbox className="h-7 w-7 text-kobipo-blue" />
            Gelen E-Faturalar
          </h1>
          <p className="text-sm text-muted-foreground">
            Mysoft InvoiceInbox üzerinden çekilen gelen e-fatura/e-arşiv listesi
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded border px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={isSyncing || isLoading}
          >
            <option value={7}>Son 7 gün</option>
            <option value={30}>Son 30 gün</option>
            <option value={90}>Son 90 gün</option>
            <option value={180}>Son 6 ay</option>
            <option value={365}>Son 1 yıl</option>
          </select>
          <Button onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Mysoft'tan Senkronize Et
          </Button>
          <Button variant="outline" onClick={fetchList} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Yenile
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Card className="border-slate-200 dark:border-slate-700/60">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Toplam
              </p>
              <p className="text-2xl font-bold">{stats.total.count}</p>
              <p className="text-xs text-muted-foreground">{fmtSum(stats.total.sum)}</p>
            </div>
            <Inbox className="h-8 w-8 text-slate-300 dark:text-slate-500" />
          </CardContent>
        </Card>
        <Card className="border-emerald-200 dark:border-emerald-500/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Kabul
              </p>
              <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">
                {stats.accepted.count}
              </p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                {fmtSum(stats.accepted.sum)}
              </p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-300 dark:text-emerald-500/70" />
          </CardContent>
        </Card>
        <Card className="border-red-200 dark:border-red-500/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-red-700 dark:text-red-300">
                Red
              </p>
              <p className="text-2xl font-bold text-red-800 dark:text-red-200">
                {stats.rejected.count}
              </p>
              <p className="text-xs text-red-700/80 dark:text-red-300/80">
                {fmtSum(stats.rejected.sum)}
              </p>
            </div>
            <XCircle className="h-8 w-8 text-red-300 dark:text-red-500/70" />
          </CardContent>
        </Card>
        <Card className="border-amber-200 dark:border-amber-500/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-300">
                Bekleyen
              </p>
              <p className="text-2xl font-bold text-amber-800 dark:text-amber-200">
                {stats.pending.count}
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                {fmtSum(stats.pending.sum)}
              </p>
            </div>
            <Clock className="h-8 w-8 text-amber-300 dark:text-amber-500/70" />
          </CardContent>
        </Card>
      </div>

      {/* Linked banner */}
      {stats.linked.count > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <Link2 className="h-4 w-4" />
          <span>
            <strong>{stats.linked.count}</strong> fatura zaten alış faturasına dönüştürülmüş ·
            Toplam tutar: {fmtSum(stats.linked.sum)}
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {filtered.length} fatura listelendi
          </CardTitle>
          <CardDescription>
            Liste DB'den okunur — güncel veri için "Mysoft'tan Senkronize Et" butonuna basın.
            Bir satıra tıklayarak detay sayfasına gidebilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Fatura no / gönderici / VKN / ETTN ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <select
              className="rounded border px-2 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Tüm durumlar</option>
              <option value="KABUL">Kabul</option>
              <option value="RED">Red</option>
              <option value="BEKLEMEDE">Beklemede</option>
            </select>
            <select
              className="rounded border px-2 py-1.5 text-sm"
              value={profileFilter}
              onChange={(e) => setProfileFilter(e.target.value)}
            >
              <option value="">Tüm profiller</option>
              <option value="TICARIFATURA">Ticari Fatura</option>
              <option value="TEMELFATURA">Temel Fatura</option>
              <option value="EARSIVFATURA">E-Arşiv</option>
            </select>
            <select
              className="rounded border px-2 py-1.5 text-sm"
              value={linkFilter}
              onChange={(e) => setLinkFilter(e.target.value)}
            >
              <option value="">Tümü (dönüştürülen/dönüştürülmeyen)</option>
              <option value="linked">Dönüştürülenler</option>
              <option value="unlinked">Dönüştürülmeyenler</option>
            </select>
          </div>

          <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>Fatura Tarihi</StyledTableHead>
                  <StyledTableHead>Gönderilme Tarihi</StyledTableHead>
                  <StyledTableHead>Fatura No</StyledTableHead>
                  <StyledTableHead>Gönderen Ünvanı</StyledTableHead>
                  <StyledTableHead>Firma VKN</StyledTableHead>
                  <StyledTableHead>Profil</StyledTableHead>
                  <StyledTableHead>Tip</StyledTableHead>
                  <StyledTableHead className="text-right">Net</StyledTableHead>
                  <StyledTableHead className="text-right">KDV</StyledTableHead>
                  <StyledTableHead className="text-right">Tutar</StyledTableHead>
                  <StyledTableHead>Durum</StyledTableHead>
                  <StyledTableHead>Senkronize</StyledTableHead>
                  <StyledTableHead className="text-right">İşlem</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center">
                      <Inbox className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
                      <p className="text-muted-foreground">
                        {rows.length === 0
                          ? "Henüz çekilmiş gelen fatura yok. Yukarıdan 'Mysoft'tan Senkronize Et' butonuna basın."
                          : "Aramaya / filtreye uyan kayıt yok."}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row, idx) => {
                    // Satır hedefi; "Belge No" hücresindeki gerçek bağlantı da bunu kullanır.
                    const rowHref = `/alis/gelen-e-faturalar/${encodeURIComponent(
                      row.uuid,
                    )}?company=${encodeURIComponent(companyId)}`
                    return (
                      <StyledTableRow
                        key={row.id}
                        index={idx}
                        className="cursor-pointer"
                        // Satırın tamamı bağlantı yüzeyi: sağ tık → "yeni sekmede aç".
                        href={rowHref}
                        hrefLabel={row.invoiceNo ? `${row.invoiceNo} detayı` : undefined}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          <div>{fmtDate(row.date)}</div>
                          {fmtTimeIfMeaningful(row.date) && (
                            <div className="text-[11px] text-muted-foreground">
                              {fmtTimeIfMeaningful(row.date)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          {row.sentDate ? fmtDateTime(row.sentDate) : "-"}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-kobipo-blue dark:text-kobipo-mid">
                          {/* Gerçek bağlantı: sağ tık → "yeni sekmede aç" burada çalışır. */}
                          {row.invoiceNo ? (
                            <Link href={rowHref} className="hover:underline">
                              {row.invoiceNo}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                            <span className="truncate max-w-[260px]" title={row.sender.name || ""}>
                              {row.sender.name || "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.sender.taxNumber || "-"}
                        </TableCell>
                        <TableCell>
                          <ProfileBadge profile={row.profile} />
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={row.invoiceType} />
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          {fmtCurrency(row.taxExclusiveAmount, row.currency || "TRY")}
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          {fmtCurrency(row.vatAmount, row.currency || "TRY")}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold whitespace-nowrap">
                          {fmtCurrency(row.totalAmount, row.currency || "TRY")}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                          {row.isLinkedToPurchase && (
                            <span
                              className="ml-1 inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200"
                              title="Bu fatura alış faturasına dönüştürülmüş"
                            >
                              <Link2 className="h-2.5 w-2.5" />
                              Bağlı
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {fmtDateTime(row.syncedAt)}
                        </TableCell>
                        {/* Aksiyon hücresi bağlantı kaplamasının dışında. */}
                        <TableCell data-row-link-skip className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {row.profile === "TICARIFATURA" &&
                              (row.status || "").toUpperCase() !== "KABUL" &&
                              (row.status || "").toUpperCase() !== "RED" && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRespond(row.uuid, "accept", row.invoiceNo)}
                                    disabled={respondingUuid === row.uuid}
                                    title="Kabul et"
                                    className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-200"
                                  >
                                    {respondingUuid === row.uuid ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRespond(row.uuid, "reject", row.invoiceNo)}
                                    disabled={respondingUuid === row.uuid}
                                    title="Reddet"
                                    className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-500/15 dark:hover:text-red-200"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDownloadPdf(row.uuid, row.invoiceNo)}
                              disabled={downloadingPdfUuid === row.uuid}
                              title="PDF indir / aç"
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-500/15 dark:hover:text-rose-200"
                            >
                              {downloadingPdfUuid === row.uuid ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FileDown className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push(rowHref)}
                              title="Detay"
                              className="text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-500/15 dark:hover:text-amber-200"
                            >
                              <Hash className="h-4 w-4" />
                            </Button>
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
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>
  const s = status.toUpperCase()
  const cls =
    s === "KABUL"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200"
      : s === "RED"
        ? "border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
        : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200"
  const label = s === "KABUL" ? "Kabul Edildi" : s === "RED" ? "Reddedildi" : status
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  )
}

function ProfileBadge({ profile }: { profile: string | null }) {
  if (!profile) return <span className="text-xs text-muted-foreground">-</span>
  const map: Record<string, { label: string; cls: string }> = {
    TICARIFATURA: {
      label: "Ticari",
      cls: "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-500/40",
    },
    TEMELFATURA: {
      label: "Temel",
      cls: "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/40",
    },
    EARSIVFATURA: {
      label: "E-Arşiv",
      cls: "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-cyan-500/40",
    },
    EFATURA: {
      label: "E-Fatura",
      cls: "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40",
    },
  }
  const entry =
    map[profile] || {
      label: profile,
      cls: "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/40",
    }
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${entry.cls}`}
    >
      {entry.label}
    </span>
  )
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-muted-foreground">-</span>
  const map: Record<string, string> = {
    SATIS:
      "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40",
    TEVKIFAT:
      "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/40",
    IADE:
      "bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-300 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/40",
    ISTISNA:
      "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40",
    OZELMATRAH:
      "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-cyan-500/40",
    IHRACAT:
      "bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/40",
  }
  const cls =
    map[type] ||
    "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/40"
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {type}
    </span>
  )
}
