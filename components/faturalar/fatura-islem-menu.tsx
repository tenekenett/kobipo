"use client"

import { useRef, useState } from "react"
import { ChevronDown, Download, Loader2, LogIn, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCanEditHere, useCanExport } from "@/components/dashboard/write-guard"
import { downloadExport } from "@/components/export/export-button"
import { toDateInput } from "@/lib/format"
import { FaturaIceAktarDialog, type IceAktarTuru } from "@/components/faturalar/fatura-ice-aktar-dialog"

/**
 * Alış ve Satış Faturaları ekranlarının "İşlem Yap" menüsü.
 *
 *   ALIŞ                                         SATIŞ
 *   FİŞ FATURA → İçeri Aktar                     Satış Faturalarını İçeri Aktar
 *   GİDERLER   → Dışarı Aktar                    İhracat Faturalarını İçeri Aktar
 *              → Kobipo Şablonu ile Dışarı Aktar ─────
 *              → e-Faturaları İndir              Dışarı Aktar
 *              → e-Faturaları UBL Olarak İndir   Kobipo Şablonu ile Dışarı Aktar
 *                                               e-Faturaları İndir
 *                                               e-Fatura XML İndir
 *
 * "Dışarı Aktar" fatura başına tek satırlık Excel'dir (eski "Dışa Aktar" düğmesi);
 * Kobipo şablonu kalem bazlıdır ve İçeri Aktar'ın okuduğu biçimdir. Dışarı
 * aktarımların hepsi ekrandaki süzgeçleri taşır (`filterParams`) ve sunucuda ekranla
 * AYNI sorgudan beslenir — ekranın 500 satır tavanı dosyayı kesmez.
 */

type FilterParams = Record<string, string | number | null | undefined>

type ArchiveItem = {
  invoiceNo: string | null
  date: string | null
  counterpartyName: string | null
  pdfUrl: string
  xmlUrl: string
}
type ArchiveKind = "pdf" | "xml"
type ArchiveProgress = { kind: ArchiveKind; total: number; done: number; failed: number }

/** Tek seferde indirilecek belge tavanı — tarayıcıda zip belleği ve Mysoft yükü. */
const ARCHIVE_MAX = 500
const ARCHIVE_CONCURRENCY = 4

const ASCII_MAP: Record<string, string> = {
  ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U",
}

/** Zip içi dosya adı: ASCII, işletim sisteminin yasakladığı karakterler olmadan. */
function safePart(value: string | null | undefined, max = 40): string {
  return String(value || "")
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => ASCII_MAP[c] ?? c)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
}

function archiveFileName(item: ArchiveItem, kind: ArchiveKind, used: Set<string>): string {
  const day = item.date ? item.date.slice(0, 10) : "tarihsiz"
  const base = [day, safePart(item.invoiceNo, 32) || "belge", safePart(item.counterpartyName)]
    .filter(Boolean)
    .join("_")
  let name = `${base}.${kind}`
  let n = 2
  while (used.has(name)) name = `${base}_${n++}.${kind}`
  used.add(name)
  return name
}

export function FaturaIslemMenu({
  yon,
  companyId,
  filterParams,
  onImported,
}: {
  yon: "alis" | "satis"
  companyId: string
  /** Ekrandaki süzgeçler: days | startDate+endDate, status, search, category, counterparty, taxNumber, minAmount, maxAmount. */
  filterParams: FilterParams
  onImported: () => void
}) {
  const { toast } = useToast()
  const canExport = useCanExport()
  const canEdit = useCanEditHere()
  const [busy, setBusy] = useState<null | "excel" | "sablon" | ArchiveKind>(null)
  const [importTur, setImportTur] = useState<IceAktarTuru | null>(null)
  const [progress, setProgress] = useState<ArchiveProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  if (!canExport && !canEdit) return null

  const alis = yon === "alis"

  const runExport = async (kind: "excel" | "sablon") => {
    setBusy(kind)
    const result =
      kind === "excel"
        ? await downloadExport({
            dataset: "invoices",
            companyId,
            format: "xlsx",
            params: { ...filterParams, direction: alis ? "incoming" : "outgoing", includeInbox: "false" },
          })
        : await downloadExport({
            dataset: alis ? "alis-fatura-sablon" : "satis-fatura-sablon",
            companyId,
            format: "xlsx",
            params: filterParams,
          })
    setBusy(null)
    if (!result.ok) toast({ title: "Dışarı aktarılamadı", description: result.error, variant: "destructive" })
  }

  const runArchive = async (kind: ArchiveKind) => {
    setBusy(kind)
    try {
      const query = new URLSearchParams({ companyId })
      for (const [key, value] of Object.entries(filterParams)) {
        if (value === null || value === undefined || value === "") continue
        query.set(key, String(value))
      }
      const listRes = await fetch(`/api/faturalar/${yon}/e-faturalar?${query.toString()}`)
      const list = await listRes.json().catch(() => ({}))
      if (!listRes.ok) {
        toast({ title: "e-Faturalar listelenemedi", description: list?.error || "Bilinmeyen hata", variant: "destructive" })
        return
      }
      const items: ArchiveItem[] = Array.isArray(list.items) ? list.items : []
      const skipped = Number(list.skipped) || 0
      const skippedText = skipped > 0 ? `${skipped} fatura ${list.skippedReason}` : ""
      if (items.length === 0) {
        toast({
          title: "İndirilecek e-Fatura yok",
          description: skipped > 0 ? `Süzgece uyan faturaların resmî belgesi yok: ${skippedText}.` : "Süzgece uyan fatura yok.",
        })
        return
      }
      if (items.length > ARCHIVE_MAX) {
        toast({
          title: "Çok fazla belge",
          description: `Süzgeçte ${items.length} e-Fatura var; tek seferde en fazla ${ARCHIVE_MAX} belge indirilir. Tarih aralığını daraltın.`,
          variant: "destructive",
        })
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      setProgress({ kind, total: items.length, done: 0, failed: 0 })

      const JSZip = (await import("jszip")).default
      const zip = new JSZip()
      const used = new Set<string>()
      const failures: string[] = []
      let next = 0
      let done = 0

      const worker = async () => {
        while (next < items.length && !controller.signal.aborted) {
          const item = items[next++]
          try {
            const res = await fetch(kind === "pdf" ? item.pdfUrl : item.xmlUrl, { signal: controller.signal })
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              throw new Error(data?.error || `HTTP ${res.status}`)
            }
            zip.file(archiveFileName(item, kind, used), await res.blob())
          } catch (error: any) {
            if (controller.signal.aborted) return
            failures.push(
              `${item.invoiceNo || "?"}${item.counterpartyName ? ` (${item.counterpartyName})` : ""}: ${error?.message || "alınamadı"}`,
            )
          } finally {
            done++
            setProgress({ kind, total: items.length, done, failed: failures.length })
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(ARCHIVE_CONCURRENCY, items.length) }, worker))

      if (controller.signal.aborted) {
        toast({ title: "İndirme iptal edildi" })
        return
      }
      const included = items.length - failures.length
      if (included === 0) {
        toast({ title: "Hiçbir belge alınamadı", description: failures[0] || "Bilinmeyen hata", variant: "destructive" })
        return
      }

      // Eksik kalan her şey arşivin İÇİNDE de yazar: zip muhasebeciye iletildiğinde
      // toast görünmez, "neden 3 fatura yok" sorusunun cevabı dosyada olmalı.
      const notes: string[] = []
      if (failures.length > 0) {
        notes.push(`İndirilemeyen ${failures.length} belge:`, ...failures.map((f) => `  - ${f}`), "")
      }
      if (skipped > 0) notes.push(`Süzgece uyan ${skippedText}; resmî belgeleri arşivde yok.`, "")
      if (list.truncated) {
        notes.push("Liste 10.000 fatura sınırına ulaştı; tarih aralığını daraltarak kalanları ayrıca indirin.", "")
      }
      if (notes.length > 0) zip.file("OKUBENI.txt", notes.join("\r\n"))

      const blob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${alis ? "Alis" : "Satis"}_e-Faturalari_${kind === "pdf" ? "PDF" : "XML"}_${toDateInput(new Date())}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      const parts = [`${included} belge indirildi`]
      if (failures.length > 0) parts.push(`${failures.length} belge alınamadı (ayrıntı zip içinde OKUBENI.txt)`)
      if (skipped > 0) parts.push(`${skippedText}, dahil değil`)
      toast({
        title: kind === "pdf" ? "e-Faturalar indirildi" : "XML dosyaları indirildi",
        description: parts.join(" · "),
        variant: failures.length > 0 ? "destructive" : undefined,
      })
    } catch (error: any) {
      toast({ title: "İndirme başarısız", description: error?.message || "Bilinmeyen hata", variant: "destructive" })
    } finally {
      abortRef.current = null
      setProgress(null)
      setBusy(null)
    }
  }

  // Menü etiketleri BÜYÜK HARFLE YAZILI: CSS `uppercase` dil etiketi olmadan "i"yi
  // "I" yapar ("FIŞ FATURA", "GIDERLER").
  const groupLabel = "px-2 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-muted-foreground"
  const item = "cursor-pointer"

  const exportItems = (
    <>
      <DropdownMenuItem className={item} onSelect={() => void runExport("excel")}>
        <LogOut className="mr-2 h-4 w-4" />
        Dışarı Aktar
      </DropdownMenuItem>
      <DropdownMenuItem className={item} onSelect={() => void runExport("sablon")}>
        <LogOut className="mr-2 h-4 w-4" />
        Kobipo Şablonu ile Dışarı Aktar
      </DropdownMenuItem>
      <DropdownMenuItem className={item} onSelect={() => void runArchive("pdf")}>
        <Download className="mr-2 h-4 w-4" />
        e-Faturaları İndir
      </DropdownMenuItem>
      <DropdownMenuItem className={item} onSelect={() => void runArchive("xml")}>
        <Download className="mr-2 h-4 w-4" />
        {alis ? "e-Faturaları UBL Olarak İndir" : "e-Fatura XML İndir"}
      </DropdownMenuItem>
    </>
  )

  return (
    <>
      {/* modal={false}: menüden açılan pencere kapanınca gövdede `pointer-events: none`
          asılı kalmasın (Radix menü + dialog etkileşimi). */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={busy !== null}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {busy ? "Hazırlanıyor..." : "İşlem Yap"}
            <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {alis ? (
            <>
              {canEdit && (
                <>
                  <DropdownMenuLabel className={groupLabel}>FİŞ FATURA</DropdownMenuLabel>
                  <DropdownMenuItem className={item} onSelect={() => setImportTur("alis")}>
                    <LogIn className="mr-2 h-4 w-4" />
                    İçeri Aktar
                  </DropdownMenuItem>
                </>
              )}
              {canEdit && canExport && <DropdownMenuSeparator />}
              {canExport && (
                <>
                  <DropdownMenuLabel className={groupLabel}>GİDERLER</DropdownMenuLabel>
                  {exportItems}
                </>
              )}
            </>
          ) : (
            <>
              {canEdit && (
                <>
                  <DropdownMenuItem className={item} onSelect={() => setImportTur("satis")}>
                    <LogIn className="mr-2 h-4 w-4" />
                    Satış Faturalarını İçeri Aktar
                  </DropdownMenuItem>
                  <DropdownMenuItem className={item} onSelect={() => setImportTur("ihracat")}>
                    <LogIn className="mr-2 h-4 w-4" />
                    İhracat Faturalarını İçeri Aktar
                  </DropdownMenuItem>
                </>
              )}
              {canEdit && canExport && <DropdownMenuSeparator />}
              {canExport && exportItems}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && importTur && (
        <FaturaIceAktarDialog
          key={importTur}
          tur={importTur}
          open
          onOpenChange={(open) => {
            if (!open) setImportTur(null)
          }}
          companyId={companyId}
          onImported={onImported}
        />
      )}

      <Dialog open={progress !== null} onOpenChange={() => undefined}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>{progress?.kind === "xml" ? "XML dosyaları indiriliyor" : "e-Faturalar indiriliyor"}</DialogTitle>
            <DialogDescription>
              Belgeler tek tek alınıp zip dosyasında toplanıyor. Bitince indirme kendiliğinden başlar.
            </DialogDescription>
          </DialogHeader>
          {progress && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {progress.done} / {progress.total}
                {progress.failed > 0 ? ` · ${progress.failed} belge alınamadı` : ""}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              İptal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
