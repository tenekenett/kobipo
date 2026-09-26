"use client"

import { useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { downloadExport } from "@/components/export/export-button"

/**
 * Faturaları Kobipo şablonundan içe aktarma penceresi (alış, satış, ihracat).
 *
 * Akış: dosya seç → sunucu ÖNİZLEME döner (hiçbir şey yazılmaz) → kullanıcı hazır
 * faturaları aktarır → sonuç. Önizlemede her faturanın cari eşleşmesi, önerilen
 * vadesi, toplamı ve hataları görünür; hatalı fatura aktarılmaz ve bunu düğme söyler.
 *
 * Aktarım PARÇA PARÇA gider (CHUNK): sunucu her parçada dosyayı yeniden okur ve
 * planı baştan kurar (bkz. lib/faturalar/ice-aktar-handler.ts).
 */

export type IceAktarTuru = "alis" | "satis" | "ihracat"

// Parça başına fatura: her fatura editör çekirdeğinden geçiyor (stok, muhasebe,
// kota). Yerel ölçümde fatura başına ~6 sn (uzak veritabanı); canlı 60 sn istek
// sınırına pay bırakmak için 10.
const CHUNK = 10
const MAX_FILE_BYTES = 3 * 1024 * 1024

const TUR: Record<
  IceAktarTuru,
  { title: string; cari: string; endpoint: string; dataset: string; templateParams: Record<string, string>; notes: string[] }
> = {
  alis: {
    title: "Alış Faturalarını İçeri Aktar",
    cari: "Tedarikçi",
    endpoint: "/api/faturalar/alis/ice-aktar",
    dataset: "alis-fatura-sablon",
    templateParams: { bos: "1" },
    notes: ["Ürün koduyla bağlanan kalemler stoğa GİRİŞ yapar."],
  },
  satis: {
    title: "Satış Faturalarını İçeri Aktar",
    cari: "Müşteri",
    endpoint: "/api/faturalar/satis/ice-aktar",
    dataset: "satis-fatura-sablon",
    templateParams: { bos: "1" },
    notes: [
      "Faturalar onaylı kayıt olarak açılır ve GİB'e GÖNDERİLMEZ — başka yerde kesilmiş faturaları Kobipo'ya almak içindir.",
      "Ürün koduyla bağlanan kalemler stoktan DÜŞER.",
    ],
  },
  ihracat: {
    title: "İhracat Faturalarını İçeri Aktar",
    cari: "Müşteri",
    endpoint: "/api/faturalar/satis/ice-aktar",
    dataset: "satis-fatura-sablon",
    templateParams: { bos: "1", tur: "ihracat" },
    notes: [
      "Faturalar onaylı kayıt olarak açılır ve GİB'e GÖNDERİLMEZ; \"İhracat\" etiketiyle işaretlenir.",
      "KDV %0 olmalı; KDV İstisna Kodu boşsa 301 (mal ihracatı) yazılır. Yeni müşteri kartında Ülke zorunludur.",
      "Ürün koduyla bağlanan kalemler stoktan DÜŞER.",
    ],
  },
}

type PlanSummary = {
  key: string
  rows: number[]
  invoiceNo: string
  date: string | null
  dueDate: string | null
  dueDateSource: "dosya" | "kart" | null
  counterparty: { kind: "existing" | "new"; name: string; taxNumber: string | null } | null
  currency: string
  category: string
  lineCount: number
  stockLineCount: number
  totals: { net: number; vat: number; total: number } | null
  errors: string[]
  warnings: string[]
}

type Preview = {
  unknownColumns: string[]
  canCreateCounterparty: boolean
  summary: { invoices: number; ready: number; failed: number; newCounterparties: number }
  invoices: PlanSummary[]
}

type ImportResult = {
  key: string
  invoiceNo: string
  ok: boolean
  error?: string
  warning?: string
  createdCounterparty?: string
}

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "preview"; preview: Preview }
  | { kind: "importing"; preview: Preview; done: number; total: number }
  | { kind: "done"; results: ImportResult[] }

/**
 * Önizleme tutarı faturanın KENDİ para birimiyle. Ortak `formatMoney` yalnız
 * TRY/USD/EUR tanır ve diğerlerini TRY'ye düşürür — GBP faturası önizlemede
 * "₺100" görünürdü. Intl'in tanımadığı kodda sayı + kod yazılır.
 */
function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(amount)
  } catch {
    return `${amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  }
}

function formatDay(iso: string | null): string {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  return `${d}.${m}.${y}`
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || "")
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error || new Error("Dosya okunamadı"))
    reader.readAsDataURL(file)
  })
}

export function FaturaIceAktarDialog({
  tur,
  open,
  onOpenChange,
  companyId,
  onImported,
}: {
  tur: IceAktarTuru
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  onImported: () => void
}) {
  const cfg = TUR[tur]
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templateBusy, setTemplateBusy] = useState(false)

  const busy = stage.kind === "reading" || stage.kind === "importing"

  const reset = () => {
    setStage({ kind: "idle" })
    setFile(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  const handleOpenChange = (next: boolean) => {
    // Aktarım sürerken pencere kapanmaz: yarıda kalan parça kullanıcıdan gizlenirdi.
    if (!next && busy) return
    if (!next) reset()
    onOpenChange(next)
  }

  const downloadTemplate = async () => {
    setTemplateBusy(true)
    const result = await downloadExport({
      dataset: cfg.dataset,
      companyId,
      format: "xlsx",
      params: cfg.templateParams,
    })
    setTemplateBusy(false)
    if (!result.ok) toast({ title: "Şablon indirilemedi", description: result.error, variant: "destructive" })
  }

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, tur, ...payload }),
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  const handleFile = async (selected: File | undefined) => {
    setError(null)
    if (!selected) return
    if (selected.size > MAX_FILE_BYTES) {
      setError("Dosya 3 MB'tan büyük. Dosyayı bölüp parça parça aktarın.")
      return
    }
    setStage({ kind: "reading" })
    try {
      const base64 = await fileToBase64(selected)
      setFile({ name: selected.name, base64 })
      const { res, data } = await post({ mode: "preview", fileBase64: base64, fileName: selected.name })
      if (!res.ok) {
        setError(data?.error || "Dosya okunamadı.")
        setStage({ kind: "idle" })
        return
      }
      setStage({ kind: "preview", preview: data as Preview })
    } catch (e: any) {
      setError(e?.message || "Dosya okunamadı.")
      setStage({ kind: "idle" })
    }
  }

  const runImport = async (preview: Preview) => {
    if (!file) return
    const keys = preview.invoices.filter((p) => p.errors.length === 0).map((p) => p.key)
    if (keys.length === 0) return
    const results: ImportResult[] = []
    setStage({ kind: "importing", preview, done: 0, total: keys.length })
    for (let i = 0; i < keys.length; i += CHUNK) {
      const part = keys.slice(i, i + CHUNK)
      try {
        const { res, data } = await post({ mode: "import", fileBase64: file.base64, fileName: file.name, keys: part })
        if (!res.ok) {
          const message = data?.error || `İstek başarısız (HTTP ${res.status}).`
          for (const key of part) {
            const plan = preview.invoices.find((p) => p.key === key)
            results.push({ key, invoiceNo: plan?.invoiceNo || "", ok: false, error: message })
          }
        } else {
          results.push(...((data?.results as ImportResult[]) || []))
        }
      } catch (e: any) {
        // Bağlantı koptu: bu parçanın sonucu BİLİNMİYOR (sunucu yazmış olabilir).
        // Kullanıcıya böyle söylenir; dosyayı yeniden yüklerse yazılmış olanlar
        // "zaten kayıtlı" diye önizlemede görünür.
        for (const key of part) {
          const plan = preview.invoices.find((p) => p.key === key)
          results.push({
            key,
            invoiceNo: plan?.invoiceNo || "",
            ok: false,
            error: `Bağlantı hatası — sonuç bilinmiyor; dosyayı yeniden yükleyip kontrol edin (${e?.message || "ağ hatası"}).`,
          })
        }
      }
      setStage({ kind: "importing", preview, done: Math.min(keys.length, i + part.length), total: keys.length })
    }
    setStage({ kind: "done", results })
    if (results.some((r) => r.ok)) onImported()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{cfg.title}</DialogTitle>
          <DialogDescription>
            Kobipo şablonuyla hazırlanmış Excel dosyasından fatura açın. Her satır bir kalemdir; aynı
            Fatura No&apos;ya sahip satırlar tek faturada toplanır.
          </DialogDescription>
        </DialogHeader>

        {(stage.kind === "idle" || stage.kind === "reading") && (
          <div className="space-y-4">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {cfg.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>

            <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <p className="font-medium">1. Şablonu indirin</p>
                <p className="text-muted-foreground">
                  Sütun açıklamaları ve bir örnek dosyanın içinde. Mevcut faturalarınızı &ldquo;Kobipo Şablonu ile
                  Dışarı Aktar&rdquo; ile indirip aynı biçimde de kullanabilirsiniz.
                </p>
              </div>
              <Button variant="outline" onClick={downloadTemplate} disabled={templateBusy} className="shrink-0">
                {templateBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                )}
                Boş şablonu indir
              </Button>
            </div>

            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="mb-3 text-sm font-medium">2. Doldurduğunuz dosyayı seçin</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
              <Button onClick={() => inputRef.current?.click()} disabled={stage.kind === "reading"}>
                {stage.kind === "reading" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {stage.kind === "reading" ? "Dosya kontrol ediliyor..." : "Dosya seç (.xlsx, .xls, .csv)"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Önce önizleme gösterilir; onaylamadan hiçbir fatura yazılmaz.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {(stage.kind === "preview" || stage.kind === "importing") && (
          <PreviewView preview={stage.preview} fileName={file?.name || ""} cari={cfg.cari} />
        )}

        {stage.kind === "importing" && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round((stage.done / Math.max(1, stage.total)) * 100)}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {stage.done} / {stage.total} fatura işlendi — pencereyi kapatmayın.
            </p>
          </div>
        )}

        {stage.kind === "done" && <ResultView results={stage.results} cari={cfg.cari} />}

        <DialogFooter className="gap-2">
          {stage.kind === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>
                Başka dosya seç
              </Button>
              <Button
                onClick={() => void runImport(stage.preview)}
                disabled={stage.preview.summary.ready === 0}
              >
                {stage.preview.summary.ready === 0
                  ? "Aktarılabilir fatura yok"
                  : stage.preview.summary.failed > 0
                    ? `${stage.preview.summary.ready} faturayı aktar (${stage.preview.summary.failed} hatalı atlanır)`
                    : `${stage.preview.summary.ready} faturayı aktar`}
              </Button>
            </>
          )}
          {stage.kind === "importing" && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Aktarılıyor...
            </Button>
          )}
          {stage.kind === "done" && (
            <>
              <Button variant="outline" onClick={reset}>
                Yeni dosya aktar
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Kapat</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewView({ preview, fileName, cari }: { preview: Preview; fileName: string; cari: string }) {
  const { summary } = preview
  const cariLower = cari.toLocaleLowerCase("tr-TR")
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{fileName}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{summary.invoices} fatura</span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
          {summary.ready} hazır
        </span>
        {summary.failed > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-500/15 dark:text-red-200">
            {summary.failed} hatalı
          </span>
        )}
        {summary.newCounterparties > 0 && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
            {summary.newCounterparties} yeni {cariLower} kartı açılacak
          </span>
        )}
      </div>
      {preview.unknownColumns.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Tanınmayan, okunmayan sütunlar: {preview.unknownColumns.join(", ")}
        </p>
      )}

      <div className="max-h-[45vh] overflow-auto rounded-md border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Durum</th>
              <th className="px-2 py-2 text-left font-medium">Fatura No</th>
              <th className="px-2 py-2 text-left font-medium">Tarih / Vade</th>
              <th className="px-2 py-2 text-left font-medium">{cari}</th>
              <th className="px-2 py-2 text-right font-medium">Kalem</th>
              <th className="px-2 py-2 text-right font-medium">Toplam</th>
            </tr>
          </thead>
          <tbody>
            {preview.invoices.map((plan) => {
              const ok = plan.errors.length === 0
              return (
                <tr key={plan.key} className="border-t align-top">
                  <td className="px-2 py-2">
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="Hazır" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" aria-label="Hatalı" />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium">{plan.invoiceNo || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      Satır {plan.rows[0]}
                      {plan.rows.length > 1 ? `–${plan.rows[plan.rows.length - 1]}` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <div>{formatDay(plan.date)}</div>
                    {plan.dueDate && (
                      <div className="text-xs text-muted-foreground">
                        Vade {formatDay(plan.dueDate)}
                        {plan.dueDateSource === "kart" ? " (karttan önerildi)" : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{plan.counterparty?.name || "—"}</span>
                      {plan.counterparty?.kind === "new" && (
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
                          Yeni
                        </span>
                      )}
                    </div>
                    {plan.counterparty?.taxNumber && (
                      <div className="text-xs text-muted-foreground">{plan.counterparty.taxNumber}</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {plan.lineCount}
                    {plan.stockLineCount > 0 && (
                      <div className="text-xs text-muted-foreground">{plan.stockLineCount} stoklu</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {plan.totals ? formatAmount(plan.totals.total, plan.currency) : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {preview.invoices.some((p) => p.errors.length > 0 || p.warnings.length > 0) && (
        <div className="max-h-[25vh] space-y-2 overflow-y-auto">
          {preview.invoices
            .filter((p) => p.errors.length > 0 || p.warnings.length > 0)
            .map((plan) => (
              <div key={plan.key} className="rounded-md border p-2 text-xs">
                <div className="mb-1 font-medium">
                  {plan.invoiceNo || `Satır ${plan.rows[0]}`}
                  {plan.counterparty?.name ? ` · ${plan.counterparty.name}` : ""}
                </div>
                {plan.errors.map((message, i) => (
                  <div key={`e${i}`} className="flex items-start gap-1.5 text-red-700 dark:text-red-300">
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{message}</span>
                  </div>
                ))}
                {plan.warnings.map((message, i) => (
                  <div key={`w${i}`} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{message}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function ResultView({ results, cari }: { results: ImportResult[]; cari: string }) {
  const created = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const newCounterparties = results.map((r) => r.createdCounterparty).filter((s): s is string => Boolean(s))
  const warnings = results.filter((r) => r.warning)
  const cariLower = cari.toLocaleLowerCase("tr-TR")
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
          {created.length} fatura aktarıldı
        </span>
        {failed.length > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-500/15 dark:text-red-200">
            {failed.length} fatura aktarılamadı
          </span>
        )}
        {newCounterparties.length > 0 && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
            {newCounterparties.length} yeni {cariLower} kartı açıldı
          </span>
        )}
      </div>
      {newCounterparties.length > 0 && (
        <p className="text-xs text-muted-foreground">Açılan kartlar: {newCounterparties.join(", ")}</p>
      )}
      {failed.length > 0 && (
        <div className="max-h-[30vh] space-y-1 overflow-y-auto rounded-md border p-2">
          {failed.map((r) => (
            <div key={r.key} className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300">
              <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <strong>{r.invoiceNo || r.key}</strong>: {r.error}
              </span>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10">
          {warnings.map((r) => (
            <div key={r.key} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{r.warning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
