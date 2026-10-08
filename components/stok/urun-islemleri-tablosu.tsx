"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Copy,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Printer,
  Search,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { BelgeLink, CariLink } from "@/components/raporlar/rapor-link"
import { fetchExportFile, downloadExport, type ExportFormat } from "@/components/export/export-button"
import { useCanExport } from "@/components/dashboard/write-guard"
import { withCompanyHref } from "@/lib/company/href"
import { formatMoney } from "@/lib/format"
import { printPdfBlob } from "@/lib/pdf/print-pdf"
import { trMatcher } from "@/lib/text/tr-fold"
import { cn } from "@/lib/utils"
import {
  filterTransactions,
  sortTransactions,
  type ProductTransactionRow,
  type TransactionSortKey,
} from "@/lib/stock/urun-islemleri-kural"

/**
 * Ürün kartının "Ürüne Ait Son 100 İşlem" tablosu — belge satırlarından (kural
 * lib/stock/urun-islemleri-kural.ts; Stok Hareketleri tablosundan farkı orada).
 *
 * Kopyala / Excel / PDF / Yazdır ekranda GÖRÜNEN listeyi verir: arama ve sıralama
 * dosyaya da aynı saf fonksiyonlarla uygulanır (dataset `urun-islemleri`).
 * Tablo kartın içinde kayar; başlık satırı yapışıktır. "Gizle" tercihi bu
 * tarayıcıda hatırlanır.
 */

const HIDDEN_KEY = "kobipo:urun-islemleri:gizli"

const fmtQty = (value: number) =>
  value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("tr-TR") : "")

/** Tür rozetinin rengi: satış mavi, alış yeşil, iade amber, irsaliye gri. */
function typeBadgeClass(row: ProductTransactionRow): string {
  if (row.typeLabel.includes("İade")) return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
  if (row.source === "WAYBILL") return "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300"
  return row.direction === "IN"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
    : "bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary"
}

function waybillListHref(row: ProductTransactionRow, companyId: string): string {
  // İrsaliyenin detay sayfası yok: liste numarayla süzülü açılır (ürün kartındaki kuralla aynı).
  const base = row.waybillType === "PURCHASE" ? "/alis/irsaliye" : "/satis/irsaliye"
  return withCompanyHref(`${base}?ara=${encodeURIComponent(row.documentNo)}`, companyId)
}

type Column = {
  key: TransactionSortKey | null
  label: string
  align?: "right"
}

const COLUMNS: Column[] = [
  { key: null, label: "Sıra" },
  { key: "type", label: "Tür" },
  { key: "documentNo", label: "Fatura No" },
  { key: "date", label: "İşlem Tarihi" },
  { key: "party", label: "Firma" },
  { key: "waybill", label: "İrsaliye No" },
  { key: "recordNo", label: "Kayıt No" },
  { key: "shipment", label: "Sevk Tarihi" },
  { key: "payment", label: "Ödeme Tipi" },
  { key: "quantity", label: "Miktar", align: "right" },
  { key: "unitPrice", label: "Birim (KDV Dahil)", align: "right" },
  { key: "total", label: "Toplam (KDV Dahil)", align: "right" },
  { key: null, label: "İşlem" },
]

export function UrunIslemleriTablosu({
  companyId,
  productId,
  /** Belge sayfasının "Geri" düğmesi bu karta dönsün. */
  backTo,
}: {
  companyId: string
  productId: string
  backTo: string
}) {
  const { toast } = useToast()
  const canExport = useCanExport()
  const [rows, setRows] = useState<ProductTransactionRow[]>([])
  const [limit, setLimit] = useState(100)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<{ key: TransactionSortKey; dir: "asc" | "desc" }>({ key: "date", dir: "desc" })
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | "print" | null>(null)

  // Gizle tercihi tarayıcıda: yalnız görünüm kolaylığı, okunamazsa açık başlar.
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN_KEY) === "1")
    } catch {
      /* depolama kapalı — varsayılan açık */
    }
  }, [])
  const toggleHidden = () => {
    setHidden((value) => {
      try {
        window.localStorage.setItem(HIDDEN_KEY, value ? "0" : "1")
      } catch {
        /* yoksay */
      }
      return !value
    })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetch(`/api/stok/products/${productId}/islemler?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { limit: number; rows: ProductTransactionRow[] }) => {
        if (cancelled) return
        setRows(data.rows)
        setLimit(data.limit)
      })
      .catch((error) => {
        if (cancelled) return
        console.error("Ürün işlemleri alınamadı:", error)
        setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, productId])

  const visible = useMemo(() => {
    const filtered = search.trim() ? filterTransactions(rows, trMatcher(search)) : rows
    return sortTransactions(filtered, sort.key, sort.dir)
  }, [rows, search, sort])

  const exportParams = { productId, search: search.trim() || null, sort: sort.key, dir: sort.dir }

  const toggleSort = (key: TransactionSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : // Tarih ve tutarlar önce büyükten, metinler önce A'dan.
          { key, dir: ["date", "shipment", "quantity", "unitPrice", "total"].includes(key) ? "desc" : "asc" },
    )

  const copyRows = async () => {
    const header = COLUMNS.filter((c) => c.label !== "İşlem").map((c) => c.label)
    const lines = visible.map((row, index) =>
      [
        String(index + 1),
        row.statusTag ? `${row.typeLabel} (${row.statusTag})` : row.typeLabel,
        row.documentNo,
        fmtDay(row.date),
        row.counterpartyName,
        row.waybillNos,
        row.recordNo,
        fmtDay(row.shipmentDate),
        row.paymentLabel,
        `${fmtQty(row.quantity)} ${row.unit}`.trim(),
        row.unitPriceGross == null ? "" : formatMoney(row.unitPriceGross, row.currency),
        row.totalGross == null ? "" : formatMoney(row.totalGross, row.currency),
      ].join("\t"),
    )
    try {
      await navigator.clipboard.writeText([header.join("\t"), ...lines].join("\n"))
      toast({ title: "Kopyalandı", description: `${visible.length} satır panoya kopyalandı; Excel'e yapıştırılabilir.` })
    } catch {
      toast({ title: "Kopyalanamadı", description: "Tarayıcı panoya yazmaya izin vermedi.", variant: "destructive" })
    }
  }

  const runExport = async (format: ExportFormat) => {
    setBusy(format)
    try {
      const result = await downloadExport({ dataset: "urun-islemleri", companyId, format, params: exportParams })
      if (!result.ok) toast({ title: "Dışa aktarılamadı", description: result.error, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  // Yazdır: aynı PDF (antetli) gizli bir çerçevede açılıp yazdırma penceresi çağrılır.
  const printRows = async () => {
    setBusy("print")
    try {
      const file = await fetchExportFile({ dataset: "urun-islemleri", companyId, format: "pdf", params: exportParams })
      if (!file.ok) {
        toast({ title: "Yazdırılamadı", description: file.error, variant: "destructive" })
        return
      }
      printPdfBlob(file.blob)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-kobipo-blue dark:text-primary" />
          Ürüne Ait Son {limit} İşlem
          {!loading && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          )}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={toggleHidden} className="h-8 text-muted-foreground">
          {hidden ? "Göster" : "Gizle"}
          {hidden ? <ChevronDown className="ml-1 h-4 w-4" /> : <ChevronUp className="ml-1 h-4 w-4" />}
        </Button>
      </CardHeader>

      {!hidden && (
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {canExport ? (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={copyRows} disabled={visible.length === 0}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Kopyala
                </Button>
                <Button variant="outline" size="sm" onClick={() => runExport("xlsx")} disabled={busy !== null || visible.length === 0}>
                  {busy === "xlsx" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />}
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => runExport("pdf")} disabled={busy !== null || visible.length === 0}>
                  {busy === "pdf" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
                  PDF
                </Button>
                <Button variant="outline" size="sm" onClick={printRows} disabled={busy !== null || visible.length === 0}>
                  {busy === "print" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Printer className="mr-1.5 h-3.5 w-3.5" />}
                  Yazdır
                </Button>
              </div>
            ) : (
              <span />
            )}
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Belge no, firma, ödeme tipi…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
          </div>

          {/* Çıplak <table>: yapışık başlık en yakın kaydırma kabına tutunur, kap TEK
              olmalı (bkz. components/raporlar/alinan-urunler-karti.tsx). */}
          <div className="max-h-[480px] overflow-auto rounded-lg border">
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))]">
                <TableRow className="hover:bg-transparent">
                  {COLUMNS.map((col) => {
                    const active = col.key !== null && sort.key === col.key
                    return (
                      <TableHead
                        key={col.label}
                        className={cn("whitespace-nowrap", col.align === "right" && "text-right")}
                        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                      >
                        {col.key ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key!)}
                            className={cn(
                              "inline-flex items-center gap-1 hover:text-foreground",
                              active && "text-foreground",
                            )}
                          >
                            {col.label}
                            {active ? (
                              sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-40" />
                            )}
                          </button>
                        ) : (
                          col.label
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length} className="py-8 text-center text-muted-foreground">
                      Yükleniyor…
                    </TableCell>
                  </TableRow>
                ) : failed ? (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length} className="py-8 text-center text-red-600 dark:text-red-400">
                      İşlemler alınamadı. Sayfayı yenileyip tekrar deneyin.
                    </TableCell>
                  </TableRow>
                ) : visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length} className="py-8 text-center text-muted-foreground">
                      {search.trim() ? "Aramaya uyan işlem yok" : "Bu ürün henüz hiçbir belgede geçmemiş"}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((row, index) => {
                    const muted = row.statusTag === "İptal" || row.statusTag === "Reddedildi"
                    return (
                      <TableRow key={row.key} className={cn(muted && "opacity-60")}>
                        <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", typeBadgeClass(row))}>
                            {row.typeLabel}
                          </span>
                          {row.statusTag && (
                            <span
                              className={cn(
                                "ml-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                muted
                                  ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
                              )}
                            >
                              {row.statusTag}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {row.source === "INVOICE" ? (
                            <BelgeLink companyId={companyId} belgeId={row.documentId} isReceipt={row.isReceipt} from={backTo}>
                              {row.documentNo}
                            </BelgeLink>
                          ) : (
                            <Link href={waybillListHref(row, companyId)} className="font-medium text-primary underline-offset-2 hover:underline">
                              {row.documentNo}
                            </Link>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{fmtDay(row.date)}</TableCell>
                        <TableCell className="max-w-[240px]">
                          <span className="block truncate" title={row.counterpartyName}>
                            {row.counterpartyKind ? (
                              <CariLink companyId={companyId} kind={row.counterpartyKind} cariRef={row.counterpartyRef} from={backTo}>
                                {row.counterpartyName}
                              </CariLink>
                            ) : (
                              row.counterpartyName || "—"
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{row.waybillNos || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{row.recordNo || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{fmtDay(row.shipmentDate) || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.paymentLabel || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {fmtQty(row.quantity)} <span className="text-xs text-muted-foreground">{row.unit}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {row.unitPriceGross == null ? "—" : formatMoney(row.unitPriceGross, row.currency)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                          {row.totalGross == null ? "—" : formatMoney(row.totalGross, row.currency)}
                        </TableCell>
                        <TableCell>
                          {row.source === "INVOICE" ? (
                            <BelgeLink
                              companyId={companyId}
                              belgeId={row.documentId}
                              isReceipt={row.isReceipt}
                              from={backTo}
                              className="inline-flex rounded-md p-1 hover:bg-accent"
                            >
                              <ArrowUpRight className="h-4 w-4" aria-label="Belgeyi aç" />
                            </BelgeLink>
                          ) : (
                            <Link
                              href={waybillListHref(row, companyId)}
                              className="inline-flex rounded-md p-1 text-primary hover:bg-accent"
                              title="İrsaliyeyi aç"
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
