"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react"
import Link from "next/link"
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
import { LinkedTableRow } from "@/components/ui/styled-table"
import { WriteAction } from "@/components/dashboard/write-guard"

type ReceiptRow = {
  id: string
  slug: string
  status: string
  convertedInvoiceId: string | null
  convertedInvoiceNo: string | null
  receiptNo: string
  date: string
  createdAt: string
  currency: string
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

/**
 * Cari detay sayfasında ilgili carinin aktif (dönüştürülmemiş) fişlerini listeler
 * ve birden fazlasını tek resmî faturaya toplu dönüştürme imkânı verir. Tek cari
 * olduğu için "aynı cari" kısıtı zaten sağlanır. Dönüşüm sonrası ekstre/bakiye
 * güncellensin diye onConverted çağrılır.
 */
export function CariFislerSection({
  companyId,
  cariId,
  direction,
  onConverted,
}: {
  companyId: string
  cariId: string
  direction: "outgoing" | "incoming"
  onConverted?: () => void
}) {
  const { toast } = useToast()

  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const cariParam = direction === "incoming" ? "supplierId" : "customerId"

  const load = useCallback(async () => {
    if (!companyId || !cariId) return
    setLoading(true)
    try {
      // scope=all: dönüştürülmüş fişler de görünsün (salt okunur olarak).
      const res = await fetch(
        `/api/fisler?companyId=${encodeURIComponent(companyId)}&direction=${direction}&scope=all&${cariParam}=${encodeURIComponent(cariId)}`,
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
  }, [companyId, cariId, direction, cariParam, toast])

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

  // Aktif fişler seçilip toplu dönüştürülebilir; dönüştürülmüş fişler salt okunur
  // (bilgi amaçlı) gösterilir. İptaller bu bölümde listelenmez.
  const activeRows = useMemo(
    () => rows.filter((r) => r.status !== "CANCELLED" && r.status !== "CONVERTED"),
    [rows],
  )
  const convertedRows = useMemo(() => rows.filter((r) => r.status === "CONVERTED"), [rows])
  const displayRows = useMemo(() => [...activeRows, ...convertedRows], [activeRows, convertedRows])

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === activeRows.length ? new Set() : new Set(activeRows.map((r) => r.id)),
    )

  const detailHref = (r: ReceiptRow) =>
    `/fisler/${r.slug || r.id}?company=${encodeURIComponent(companyId)}`

  const selectedRows = useMemo(() => activeRows.filter((r) => selected.has(r.id)), [activeRows, selected])
  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + r.totalAmount, 0),
    [selectedRows],
  )

  const convert = async () => {
    if (!companyId || selectedRows.length === 0) return
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
      onConverted?.()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Dönüştürme başarısız", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  // Gösterilecek fiş yoksa (aktif + dönüştürülmüş) bölümü hiç gösterme.
  if (!loading && displayRows.length === 0) return null

  const receiptLabel = direction === "incoming" ? "Alış Fişleri" : "Satış Fişleri"

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-5 w-5 text-kobipo-navy dark:text-kobipo-blue" />
          {receiptLabel}
          <span className="text-sm font-normal text-muted-foreground">
            ({activeRows.length} aktif
            {convertedRows.length > 0 && ` · ${convertedRows.length} dönüştürüldü`})
            {selectedRows.length > 0 && ` • ${selectedRows.length} seçili (${fmt(selectedTotal)})`}
          </span>
        </CardTitle>
        <WriteAction>
          <Button onClick={convert} disabled={selectedRows.length === 0 || submitting} size="sm">
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            Toplu Faturaya Dönüştür
            {selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
          </Button>
        </WriteAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin opacity-60" />
            Yükleniyor…
          </div>
        ) : (
          // Sınırlı yükseklik + iç kaydırma: fiş listesi uzun olsa da ekstreyi
          // bastırmasın. Sticky başlık için yükseklik Table'ın kendi sarmalayıcısına.
          <div className="[&>div]:max-h-[340px] [&>div]:rounded-md [&>div]:border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="rounded"
                      aria-label="Tümünü seç"
                      checked={activeRows.length > 0 && selected.size === activeRows.length}
                      onChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Fiş No</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                  <TableHead className="text-right">Ödenen</TableHead>
                  <TableHead className="text-center">Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((r) => {
                  const isConverted = r.status === "CONVERTED"
                  const badge = PAYMENT_BADGE[r.paymentStatus]
                  const rowHref = detailHref(r)
                  return (
                    <LinkedTableRow
                      key={r.id}
                      data-state={selected.has(r.id) ? "selected" : undefined}
                      className={`cursor-pointer ${isConverted ? "opacity-70" : ""}`}
                      // Satırın tamamı bağlantı yüzeyi: sağ tık → "yeni sekmede aç".
                      href={rowHref}
                      hrefLabel={`${r.receiptNo} detayı`}
                    >
                      {/* Seçim kutusu kaplamanın dışında kalmalı. */}
                      <TableCell data-row-link-skip onClick={(e) => e.stopPropagation()}>
                        {isConverted ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            className="rounded"
                            aria-label={`${r.receiptNo} seç`}
                            checked={selected.has(r.id)}
                            onChange={() => toggle(r.id)}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">
                        {/* Gerçek bağlantı: sağ tık → "yeni sekmede aç" burada çalışır. */}
                        <Link href={rowHref} className="hover:underline">
                          {r.receiptNo}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div>{new Date(r.date).toLocaleDateString("tr-TR")}</div>
                        {r.createdAt && (
                          <div className="text-xs text-muted-foreground/70">
                            {new Date(r.createdAt).toLocaleTimeString("tr-TR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmt(r.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmt(r.paidAmount)}
                      </TableCell>
                      {/* İçindeki "dönüştürüldü → fatura" bağlantısı tıklanabilir kalmalı. */}
                      <TableCell data-row-link-skip className="text-center">
                        {isConverted ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Badge variant="secondary">Dönüştürüldü</Badge>
                            {r.convertedInvoiceId && r.convertedInvoiceNo && (
                              <Link
                                href={`/faturalar/${r.convertedInvoiceId}/onizleme?company=${encodeURIComponent(companyId)}`}
                                className="text-blue-600 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {r.convertedInvoiceNo}
                              </Link>
                            )}
                          </span>
                        ) : (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        )}
                      </TableCell>
                    </LinkedTableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
