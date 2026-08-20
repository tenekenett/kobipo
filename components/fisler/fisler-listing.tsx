"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { Archive, FileText, Loader2, Receipt } from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"

type Scope = "active" | "archived"

type ReceiptRow = {
  id: string
  slug: string
  status: string
  convertedInvoiceId: string | null
  convertedInvoiceNo: string | null
  receiptNo: string
  date: string
  counterpartyId: string | null
  counterpartyName: string | null
  currency: string
  netAmount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  paymentStatus: "OPEN" | "PARTIAL" | "PAID"
}

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { style: "currency", currency: "TRY" })

type Variant = ComponentProps<typeof Badge>["variant"]

const PAYMENT_BADGE: Record<ReceiptRow["paymentStatus"], { label: string; variant: Variant }> = {
  PAID: { label: "Tahsil edildi", variant: "odendi" },
  PARTIAL: { label: "Kısmî", variant: "bekliyor" },
  OPEN: { label: "Açık hesap", variant: "secondary" },
}

/** Arşivdeki fişin neden kapandığı: iptal mi, faturaya mı dönüştü. */
const ARCHIVE_BADGE: Record<string, { label: string; variant: Variant }> = {
  CANCELLED: { label: "İptal edildi", variant: "destructive" },
  CONVERTED: { label: "Faturaya dönüştürüldü", variant: "secondary" },
}

export default function FislerListing({
  direction,
  pageTitle,
  pageDescription,
}: {
  direction: "outgoing" | "incoming"
  pageTitle: string
  pageDescription: string
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [scope, setScope] = useState<Scope>("active")

  const cariLabel = direction === "incoming" ? "Tedarikçi" : "Müşteri"
  const isArchive = scope === "archived"

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/fisler?companyId=${encodeURIComponent(companyId)}&direction=${direction}&scope=${scope}`,
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Fişler yüklenemedi")
      setRows(Array.isArray(data.rows) ? data.rows : [])
      setSelected(new Set())
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Fişler yüklenemedi", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [companyId, direction, scope, toast])

  useEffect(() => {
    load()
  }, [load])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Satır tıklaması detaya gider; seçim (toplu faturaya dönüştürme için) checkbox'ta.
  const openDetail = (r: ReceiptRow) =>
    router.push(`/fisler/${r.slug || r.id}?company=${encodeURIComponent(companyId ?? "")}`)

  const toggleAll = () =>
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected])

  // Toplu dönüştürme yalnızca AYNI cariye ait fişlerde mümkün.
  const distinctCari = useMemo(
    () => new Set(selectedRows.map((r) => r.counterpartyId)),
    [selectedRows],
  )
  const selectedCari = selectedRows[0]?.counterpartyId ?? null
  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + r.totalAmount, 0),
    [selectedRows],
  )

  let blockReason: string | null = null
  if (selectedRows.length === 0) blockReason = "Dönüştürmek için fiş seçin"
  else if (distinctCari.size > 1) blockReason = `Yalnızca aynı ${cariLabel.toLowerCase()} fişleri birleştirilebilir`
  else if (!selectedCari) blockReason = `${cariLabel}i olmayan fişler faturaya dönüştürülemez`

  const convert = async () => {
    if (!companyId || blockReason) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/fisler/faturaya-donustur", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, receiptIds: Array.from(selected) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Dönüştürme başarısız")
      toast({
        title: "Fatura oluşturuldu",
        description: `${selectedRows.length} fiş → ${data.invoiceNo} birleştirildi`,
      })
      await load()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Dönüştürme başarısız", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const goToInvoices = () =>
    router.push(
      `${direction === "incoming" ? "/alis/fatura" : "/satis/fatura"}?company=${encodeURIComponent(
        companyId || "",
      )}`,
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground">{pageDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <Button
              variant={isArchive ? "ghost" : "secondary"}
              size="sm"
              onClick={() => setScope("active")}
            >
              Aktif
            </Button>
            <Button
              variant={isArchive ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setScope("archived")}
            >
              <Archive className="mr-2 h-4 w-4" />
              Arşiv
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={goToInvoices}>
            <FileText className="mr-2 h-4 w-4" />
            Faturalar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            {isArchive ? (
              <Archive className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Receipt className="h-5 w-5 text-kobipo-navy dark:text-kobipo-blue" />
            )}
            {rows.length} {isArchive ? "arşiv fişi" : "fiş"}
            {!isArchive && selectedRows.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                • {selectedRows.length} seçili ({fmt(selectedTotal)})
              </span>
            )}
          </CardTitle>
          {/* Arşivdeki fişler kapanmıştır (iptal/dönüştürülmüş) — toplu işlem yok. */}
          {!isArchive && (
            <div className="flex items-center gap-2">
              {blockReason && selectedRows.length > 0 && (
                <span className="text-xs text-amber-600">{blockReason}</span>
              )}
              <WriteAction>
                <Button onClick={convert} disabled={!!blockReason || submitting} size="sm">
                  {submitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Toplu Faturaya Dönüştür
                  {selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
                </Button>
              </WriteAction>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin opacity-60" />
              Yükleniyor…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {isArchive ? (
                <>
                  <Archive className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Arşivde fiş yok. İptal edilen ve faturaya dönüştürülen fişler burada listelenir.
                </>
              ) : (
                <>
                  <Receipt className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Henüz fiş yok. {direction === "incoming" ? "Hızlı Alış" : "Hızlı Satış"} ekranından fiş
                  kesebilirsiniz.
                </>
              )}
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {!isArchive && (
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          className="rounded"
                          aria-label="Tümünü seç"
                          checked={rows.length > 0 && selected.size === rows.length}
                          onChange={toggleAll}
                        />
                      </TableHead>
                    )}
                    <TableHead>Fiş No</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead>{cariLabel}</TableHead>
                    <TableHead className="text-right">Tutar</TableHead>
                    <TableHead className="text-right">Ödenen</TableHead>
                    <TableHead className="text-center">Durum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    // Aktifte ödeme durumu, arşivde kapanma sebebi (iptal/dönüştürüldü) gösterilir.
                    const badge = isArchive
                      ? ARCHIVE_BADGE[r.status] ?? { label: r.status, variant: "secondary" as Variant }
                      : PAYMENT_BADGE[r.paymentStatus]
                    return (
                      <TableRow
                        key={r.id}
                        data-state={selected.has(r.id) ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => openDetail(r)}
                      >
                        {!isArchive && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="rounded"
                              aria-label={`${r.receiptNo} seç`}
                              checked={selected.has(r.id)}
                              onChange={() => toggle(r.id)}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm font-medium">
                          {r.receiptNo}
                          {isArchive && r.convertedInvoiceNo && (
                            <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                              → {r.convertedInvoiceNo}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(r.date).toLocaleDateString("tr-TR")}
                        </TableCell>
                        <TableCell>{r.counterpartyName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{fmt(r.totalAmount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.paidAmount)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
