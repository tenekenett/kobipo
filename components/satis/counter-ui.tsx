"use client"

// Tezgâh ekranlarının (Hızlı Satış, Hızlı Alış, Kahveci Satış) ORTAK küçük
// parçaları. Üç ekran ayrı dosyada; bu parçalar kopyalanırsa davranışları
// ayrışıyor (2026-10-06: Hızlı Alış, Hızlı Satış'ın düzeltmelerini almamıştı).

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ExternalLink, Maximize2, Minimize2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CompanyLink } from "@/components/dashboard/company-link"
import { currency } from "@/lib/fis/receipt-html"

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{children}</kbd>
}

/**
 * Ekranda açık bir pencere var mı (ürün ekleme, fiyat geçmişi, satış sonucu…).
 * Kısayollar o sırada çalışmaz: pencerenin arkasında satış kapanmasın.
 */
export const anyDialogOpen = () =>
  typeof document !== "undefined" &&
  !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')

/** Tarayıcının tam ekranı — tezgâhta küçük ekranda (1366×768) yer kazandırır. */
export function FullscreenButton() {
  const [isFull, setIsFull] = useState(false)
  useEffect(() => {
    const sync = () => setIsFull(Boolean(document.fullscreenElement))
    sync()
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])
  const toggle = useCallback(() => {
    // Tarayıcı reddederse (iframe, izin) sessiz kalmak yeterli: ekran zaten çalışıyor.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      onClick={toggle}
      title={isFull ? "Tam ekrandan çık" : "Tam ekran"}
    >
      {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      <span className="hidden sm:inline">{isFull ? "Küçült" : "Tam ekran"}</span>
    </Button>
  )
}

export type RecentDoc = {
  id: string
  invoiceNo?: string | null
  total: number
  paymentLabel: string
  change?: number
}

/**
 * Son işlem satırı: satış penceresi kapandıktan sonra da son fiş no, tutar,
 * ödeme ve para üstü görünür; fiş tek tıkla yeniden yazdırılır. Eskiden pencere
 * kapanınca para üstü bilgisi kayboluyordu.
 */
export function RecentDocBar({
  label,
  idleText,
  doc,
  onPrint,
  children,
}: {
  /** "Son satış", "Son iade", "Son alış". */
  label: string
  /** Henüz işlem yokken yazılan metin. */
  idleText: string
  doc: RecentDoc | null
  onPrint: () => void
  /** Sağdaki ek düğmeler (fiyat gör, tam ekran). */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-xs shadow-sm">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        {doc ? (
          <>
            <span className="font-semibold text-muted-foreground">{label}:</span>
            <span className="font-mono font-semibold">{doc.invoiceNo ?? "Fiş"}</span>
            <span className="tabular-nums">· {currency(doc.total)}</span>
            <span className="text-muted-foreground">· {doc.paymentLabel}</span>
            {doc.change != null && doc.change > 0 && (
              <span className="font-semibold text-kobipo-green">· Para üstü {currency(doc.change)}</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{idleText}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {doc && (
          <>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onPrint}>
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Son fişi yazdır</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" asChild>
              <CompanyLink href={`/fisler/${doc.id}`} target="_blank">
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">Aç</span>
              </CompanyLink>
            </Button>
          </>
        )}
        {children}
      </div>
    </div>
  )
}
