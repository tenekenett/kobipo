"use client"

// Z raporu ↔ Kobipo karşılaştırması. Plan: docs/okc/ASAMA1-KOBIPO.md A3.
//
// Üç eksen ayrı tablolarda: toplam (+ fiş adedi), KDV oranı, ödeme tipi. Fark
// satırı kırmızıdır; karşılaştırılamayan durum (şubede çok cihaz + cihaza
// bağlanmamış fiş) ve Z'nin kendi iç tutarsızlığı AYRI uyarılarla söylenir —
// üçü aynı kırmızıya boyansaydı kullanıcı hangisinin gerçek fark olduğunu bilemezdi.

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Info, Pencil, Trash2, XCircle } from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"
import { CompanyLink } from "@/components/dashboard/company-link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { cn } from "@/lib/utils"
import type { Mutabakat, MutabakatRow } from "@/lib/okc/z-mutabakat"
import type { ZInternalIssue } from "@/lib/okc/z-report"
import type { ZMutabakatReceiptRow } from "@/lib/okc/z-mutabakat-query"
import type { ZReportEditable } from "@/components/okc/z-report-form"

export type ZReportDetail = ZReportEditable & {
  device: { id: string; name: string; serialNo: string; brand: string | null; model: string | null }
  source: string
  canEdit: boolean
  window: { start: string; end: string; first: boolean }
  comparable: boolean
  unassignedCount: number
  deviceCount: number
  mutabakat: Mutabakat
  internalIssues: ZInternalIssue[]
  receipts: ZMutabakatReceiptRow[]
}

const money = (value: number | null) =>
  value == null ? "—" : `${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`

const signedMoney = (value: number | null) =>
  value == null ? "—" : value === 0 ? "0,00 ₺" : `${value > 0 ? "+" : ""}${money(value)}`

const dateTime = (iso: string) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })

function AxisTable({ title, rows, note }: { title: string; rows: MutabakatRow[]; note?: string }) {
  if (rows.length === 0) return null
  const compared = rows.some((r) => r.z !== null)
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium" />
              <th className="px-3 py-2 text-right font-medium">Z raporu</th>
              <th className="px-3 py-2 text-right font-medium">Kobipo</th>
              <th className="px-3 py-2 text-right font-medium">Fark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cn("border-t", !r.ok && "bg-red-50 dark:bg-red-950/30")}>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{money(r.z)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{money(r.kobipo)}</td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-mono tabular-nums",
                    !r.ok && "font-semibold text-red-700 dark:text-red-300",
                  )}
                >
                  {signedMoney(r.diff)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compared && (
        <p className="text-xs text-muted-foreground">Bu kırılım Z raporuna girilmediği için yalnız Kobipo tarafı gösteriliyor.</p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

export function ZReportDetailDialog({
  open,
  onOpenChange,
  companyId,
  reportId,
  onEdit,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  reportId: string | null
  onEdit: (detail: ZReportDetail) => void
  onDeleted: () => void
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [detail, setDetail] = useState<ZReportDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showReceipts, setShowReceipts] = useState(false)

  useEffect(() => {
    if (!open || !reportId) return
    let cancelled = false
    setDetail(null)
    setError(null)
    setShowReceipts(false)
    fetch(`/api/okc/z-raporlari/${reportId}?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || "Z raporu alınamadı")
        if (!cancelled) setDetail(data)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Bilinmeyen hata"))
    return () => {
      cancelled = true
    }
  }, [open, reportId, companyId])

  const handleDelete = async () => {
    if (!detail) return
    if (
      !(await confirm({
        title: `Z ${detail.zNo} silinsin mi?`,
        description: "Z raporu kaydı kalıcı olarak silinir. Fişler etkilenmez.",
        confirmLabel: "Sil",
        variant: "destructive",
      }))
    ) {
      return
    }
    const res = await fetch(`/api/okc/z-raporlari/${detail.id}?companyId=${encodeURIComponent(companyId)}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Silinemedi", description: data?.error || "Bilinmeyen hata", variant: "destructive" })
      return
    }
    toast({ title: "Silindi", description: `Z ${detail.zNo} silindi` })
    onOpenChange(false)
    onDeleted()
  }

  const m = detail?.mutabakat

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{detail ? `Z ${detail.zNo} · ${detail.device.name}` : "Z raporu"}</DialogTitle>
          <DialogDescription>
            {detail
              ? `${dateTime(detail.takenAt)} · Seri ${detail.device.serialNo}${detail.ekuNo ? ` · EKÜ ${detail.ekuNo}` : ""}`
              : error ?? "Yükleniyor…"}
          </DialogDescription>
        </DialogHeader>

        {detail && m && (
          <div className="space-y-4">
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
                !detail.comparable
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
                  : m.ok
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                    : "border-red-300 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100",
              )}
            >
              {!detail.comparable ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : m.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                <p className="font-medium">
                  {!detail.comparable
                    ? "Cihaz ayrımı yapılamıyor"
                    : m.ok
                      ? "Z raporu Kobipo fişleriyle tutuyor"
                      : "Z raporu ile Kobipo arasında fark var"}
                </p>
                <p className="mt-0.5 text-xs opacity-90">
                  {!detail.comparable
                    ? `Bu şubede ${detail.deviceCount} yazarkasa var ve ${detail.unassignedCount} fiş hiçbir cihaza bağlı değil; aşağıdaki Kobipo rakamları şubenin o aralıktaki tüm fişleridir.`
                    : `${dateTime(detail.window.start)} – ${dateTime(detail.window.end)} arasında kesilen ${m.receiptCount.kobipo} fiş.`}
                  {detail.window.first &&
                    " Bu cihazın önceki Z'si girilmediği için aralık günün başından alındı."}
                </p>
              </div>
            </div>

            {detail.internalIssues.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Girilen Z rakamları kendi içinde tutmuyor
                </p>
                <ul className="mt-1 list-disc pl-6">
                  {detail.internalIssues.map((issue) => (
                    <li key={issue.message}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <AxisTable title="Toplam" rows={[m.total]} />
            {m.receiptCount.z !== null && (
              <p className={cn("text-sm", !m.receiptCount.ok && "font-medium text-red-700 dark:text-red-300")}>
                Fiş adedi: Z'de {m.receiptCount.z}, Kobipo'da {m.receiptCount.kobipo}
                {m.receiptCount.diff ? ` (fark ${m.receiptCount.diff > 0 ? "+" : ""}${m.receiptCount.diff})` : ""}
              </p>
            )}
            <AxisTable
              title="KDV oranına göre (matrah + KDV)"
              rows={m.vat}
              note={
                m.hasAllocatedDiscount
                  ? "İskontolu fişlerde indirim oranlara orantılı dağıtıldı; bu satırlarda kuruşluk fark buradan doğabilir."
                  : undefined
              }
            />
            <AxisTable title="Ödeme tipine göre" rows={m.payments} />

            <div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => setShowReceipts((v) => !v)}
              >
                <Info className="h-4 w-4" />
                {showReceipts ? "Fişleri gizle" : `Karşılaştırmaya giren ${detail.receipts.length} fişi göster`}
              </button>
              {showReceipts && (
                <div className="mt-2 max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
                  {detail.receipts.length === 0 ? (
                    <p className="p-3 text-muted-foreground">Bu aralıkta fiş yok.</p>
                  ) : (
                    detail.receipts.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <CompanyLink
                            href={`/fisler/${r.slug || r.id}`}
                            className="truncate font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {r.invoiceNo}
                          </CompanyLink>
                          {r.okcReceiptNo != null && <Badge variant="secondary">ÖKC fiş {r.okcReceiptNo}</Badge>}
                          {r.assigned && r.okcReceiptNo == null && <Badge variant="secondary">Z'ye bağlı</Badge>}
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{dateTime(r.date)}</span>
                        <span className="shrink-0 font-mono tabular-nums">{money(r.total)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {detail.note && <p className="text-sm text-muted-foreground">Not: {detail.note}</p>}
          </div>
        )}

        {detail?.canEdit && (
          <DialogFooter className="gap-2 sm:justify-between">
            <WriteAction>
              <Button variant="outline" onClick={handleDelete}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Sil
              </Button>
            </WriteAction>
            <WriteAction>
              <Button onClick={() => onEdit(detail)}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Düzelt
              </Button>
            </WriteAction>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
