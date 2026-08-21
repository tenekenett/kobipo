"use client"

import { useState } from "react"
import { Download, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/use-toast"
import { useCanExport } from "@/components/dashboard/write-guard"

/**
 * Tüm ekranların ortak "Dışa Aktar" düğmesi.
 *
 * Neden sunucu tarafı: liste ekranları sayfalı (cari 50'şer, faturalar kaynak
 * başına 500). Ekrandaki state'i dosyaya basmak kullanıcıya sessizce EKSİK veri
 * verirdi. Bunun yerine mevcut filtreler query'e çevrilip `/api/export/<dataset>`
 * çağrılır; sunucu filtreye uyan TÜM satırları üretir.
 */

type ExportFormat = "xlsx" | "pdf" | "csv"

const FORMATS: Array<{ format: ExportFormat; label: string; hint: string; Icon: typeof FileSpreadsheet }> = [
  { format: "xlsx", label: "Excel (.xlsx)", hint: "Tutarlar hesaplanabilir sayı", Icon: FileSpreadsheet },
  { format: "pdf", label: "PDF", hint: "Yazdırmaya hazır, antetli", Icon: FileText },
  { format: "csv", label: "CSV", hint: "Ham veri / yeniden içe aktarma", Icon: FileType2 },
]

export type ExportButtonProps = {
  /** `lib/export/datasets`teki anahtar. Ör. "products", "rapor-kar-zarar". */
  dataset: string
  companyId: string
  /**
   * Ekrandaki filtreler. Anahtarlar ilgili dataset'in beklediği adlarla aynı
   * olmalı. `null`/`undefined`/boş değerler atlanır.
   */
  params?: Record<string, string | number | boolean | null | undefined>
  formats?: ExportFormat[]
  label?: string
  variant?: "default" | "outline" | "ghost" | "secondary"
  size?: "default" | "sm" | "lg" | "icon"
  disabled?: boolean
  className?: string
}

/** Sunucudan gelen dosya adını çöz; yoksa makul bir yedek üret. */
function fileNameFrom(disposition: string | null, dataset: string, format: string): string {
  const utf8 = disposition?.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      /* bozuk kodlama → aşağıdaki yedeklere düş */
    }
  }
  const plain = disposition?.match(/filename="([^"]+)"/i)
  if (plain) return plain[1]
  return `${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`
}

export function ExportButton({
  dataset,
  companyId,
  params,
  formats,
  label = "Dışa Aktar",
  variant = "outline",
  size = "sm",
  disabled,
  className,
}: ExportButtonProps) {
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null)
  const { toast } = useToast()
  // Salt-okunur üyelik veriyi dışarı çıkaramaz (bkz. useCanExport). Kapıyı her ekranda
  // ayrı ayrı kurmak yerine düğmenin KENDİSİ karar veriyor: dışa aktarma tek bileşenden
  // geçtiği için burada unutulan bir ekran kalmaz.
  const canExport = useCanExport()

  const options = formats ? FORMATS.filter((item) => formats.includes(item.format)) : FORMATS

  const runExport = async (format: ExportFormat) => {
    if (!companyId) {
      toast({ title: "Firma seçilmedi", description: "Önce bir firma seçin.", variant: "destructive" })
      return
    }

    setBusyFormat(format)
    try {
      const query = new URLSearchParams({ companyId, format })
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value === null || value === undefined || value === "") continue
        query.set(key, String(value))
      }

      const response = await fetch(`/api/export/${dataset}?${query.toString()}`)

      if (!response.ok) {
        // Sunucu hatayı JSON olarak açıklıyor (ör. PDF satır sınırı); kullanıcıya
        // "bir hata oluştu" yerine gerçek sebebi göster.
        let message = "Dışa aktarma başarısız oldu."
        try {
          const payload = await response.json()
          if (payload?.error) message = payload.error
        } catch {
          /* JSON değilse genel mesajla devam */
        }
        toast({ title: "Dışa aktarılamadı", description: message, variant: "destructive" })
        return
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = fileNameFrom(response.headers.get("Content-Disposition"), dataset, format)
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Export failed:", error)
      toast({
        title: "Dışa aktarılamadı",
        description: "Bağlantı hatası. Lütfen tekrar deneyin.",
        variant: "destructive",
      })
    } finally {
      setBusyFormat(null)
    }
  }

  const isBusy = busyFormat !== null

  if (!canExport) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled || isBusy} className={className}>
          {isBusy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {isBusy ? "Hazırlanıyor..." : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Biçim seçin</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map(({ format, label: formatLabel, hint, Icon }) => (
          <DropdownMenuItem
            key={format}
            disabled={isBusy}
            onSelect={(event) => {
              // Menü kapanırken fetch'i iptal etmesin diye varsayılan davranışı
              // engelleyip indirmeyi elle başlatıyoruz.
              event.preventDefault()
              void runExport(format)
            }}
            className="flex items-start gap-2"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex flex-col">
              <span className="text-sm">{formatLabel}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ExportButton
