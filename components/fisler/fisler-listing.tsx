"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { FileText, Loader2, Receipt } from "lucide-react"

type ReceiptRow = {
  id: string
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

const PAYMENT_BADGE: Record<ReceiptRow["paymentStatus"], { label: string; cls: string }> = {
  PAID: { label: "Tahsil edildi", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  PARTIAL: { label: "Kısmî", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  OPEN: { label: "Açık hesap", cls: "bg-slate-100 text-slate-600 border-slate-200" },
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

  const cariLabel = direction === "incoming" ? "Tedarikçi" : "Müşteri"

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/fisler?companyId=${encodeURIComponent(companyId)}&direction=${direction}`,
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
  }, [companyId, direction, toast])

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
        <Button variant="outline" size="sm" onClick={goToInvoices}>
          <FileText className="mr-2 h-4 w-4" />
          Faturalar
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-5 w-5 text-kobipo-navy dark:text-kobipo-blue" />
            {rows.length} fiş
            {selectedRows.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                • {selectedRows.length} seçili ({fmt(selectedTotal)})
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {blockReason && selectedRows.length > 0 && (
              <span className="text-xs text-amber-600">{blockReason}</span>
            )}
            <Button onClick={convert} disabled={!!blockReason || submitting} size="sm">
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Toplu Faturaya Dönüştür
              {selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin opacity-60" />
              Yükleniyor…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Receipt className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Henüz fiş yok. {direction === "incoming" ? "Hızlı Alış" : "Hızlı Satış"} ekranından fiş kesebilirsiniz.
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        className="rounded"
                        aria-label="Tümünü seç"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={toggleAll}
                      />
                    </TableHead>
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
                    const badge = PAYMENT_BADGE[r.paymentStatus]
                    return (
                      <TableRow
                        key={r.id}
                        data-state={selected.has(r.id) ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => toggle(r.id)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded"
                            aria-label={`${r.receiptNo} seç`}
                            checked={selected.has(r.id)}
                            onChange={() => toggle(r.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">{r.receiptNo}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(r.date).toLocaleDateString("tr-TR")}
                        </TableCell>
                        <TableCell>{r.counterpartyName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{fmt(r.totalAmount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.paidAmount)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={badge.cls}>
                            {badge.label}
                          </Badge>
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
