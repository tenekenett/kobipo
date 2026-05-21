"use client"

import { useEffect, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
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
import { useToast } from "@/components/ui/use-toast"
import { Download, Loader2, RefreshCw, Inbox, Search, FileDown } from "lucide-react"
import { Input } from "@/components/ui/input"

interface IncomingRow {
  id: string
  uuid: string
  invoiceNo: string | null
  date: string | null
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

export default function GelenEFaturalarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [rows, setRows] = useState<IncomingRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [downloadingPdfUuid, setDownloadingPdfUuid] = useState<string | null>(null)

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

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      (r.invoiceNo || "").toLowerCase().includes(q) ||
      (r.sender.name || "").toLowerCase().includes(q) ||
      (r.sender.taxNumber || "").toLowerCase().includes(q) ||
      (r.uuid || "").toLowerCase().includes(q)
    )
  })

  const totalSum = filtered.reduce((acc, r) => acc + Number(r.totalAmount || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold">Gelen E-Faturalar</h1>
          <p className="text-muted-foreground">
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

      <Card>
        <CardHeader>
          <CardTitle>
            Toplam {filtered.length} fatura
            {filtered.length > 0 && (
              <span className="ml-3 text-sm font-normal text-muted-foreground">
                Toplam tutar:{" "}
                {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(
                  totalSum,
                )}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Liste DB'den okunur — güncel veri için "Mysoft'tan Senkronize Et" butonuna basın
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Fatura no / gönderici / VKN / ETTN ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <select
              className="rounded border px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Tüm durumlar</option>
              <option value="KABUL">Kabul</option>
              <option value="RED">Red</option>
              <option value="BEKLEMEDE">Beklemede</option>
            </select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Fatura No</TableHead>
                <TableHead>Gönderici VKN</TableHead>
                <TableHead>Gönderici</TableHead>
                <TableHead>Profil</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">KDV</TableHead>
                <TableHead className="text-right">Toplam</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center">
                    <Inbox className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-muted-foreground">
                      {rows.length === 0
                        ? "Henüz çekilmiş gelen fatura yok. Yukarıdan 'Mysoft'tan Senkronize Et' butonuna basın."
                        : "Aramaya / filtreye uyan kayıt yok."}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => {
                  const fmt = (v: string | number | null) =>
                    v === null || v === undefined
                      ? "-"
                      : new Intl.NumberFormat("tr-TR", {
                          style: "currency",
                          currency: row.currency || "TRY",
                        }).format(Number(v))
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">
                        {row.date ? new Date(row.date).toLocaleDateString("tr-TR") : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.invoiceNo || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.sender.taxNumber || "-"}
                      </TableCell>
                      <TableCell className="text-xs">{row.sender.name || "-"}</TableCell>
                      <TableCell className="text-xs">
                        {row.profile === "TICARIFATURA"
                          ? "Ticari"
                          : row.profile === "TEMELFATURA"
                            ? "Temel"
                            : row.profile || "-"}
                      </TableCell>
                      <TableCell className="text-xs">{row.invoiceType || "-"}</TableCell>
                      <TableCell className="text-right text-xs">
                        {fmt(row.taxExclusiveAmount)}
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmt(row.vatAmount)}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">
                        {fmt(row.totalAmount)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                            row.status === "KABUL"
                              ? "bg-emerald-100 text-emerald-800"
                              : row.status === "RED"
                                ? "bg-red-100 text-red-800"
                                : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {row.status || "-"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadPdf(row.uuid, row.invoiceNo)}
                          disabled={downloadingPdfUuid === row.uuid}
                          title="PDF indir / aç"
                        >
                          {downloadingPdfUuid === row.uuid ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FileDown className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
