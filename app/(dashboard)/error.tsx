"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

/**
 * Panel (dashboard) segmenti için hata sınırı.
 *
 * Neden ayrı: kök `app/error.tsx` devreye girdiğinde TÜM ekran (menü, üst bar dahil)
 * gider ve kullanıcı boş beyaz bir sayfa görür — "sayfa geçişinde beyaz ekran"
 * şikâyeti buydu. Segment sınırı yalnız içerik alanını değiştirir; menü yerinde
 * kalır, kullanıcı nerede olduğunu kaybetmez ve başka bir sayfaya geçebilir.
 *
 * Hata yine console'a ve localStorage'a yazılır (kök sınırla aynı anahtar), böylece
 * ekran hızlıca toparlansa bile iz kalır.
 */

const STORAGE_KEY = "kobipo:client-errors"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[Kobipo] Panel sayfası hatası:", error)
    try {
      const entry = {
        at: new Date().toISOString(),
        url: window.location.pathname + window.location.search,
        message: error?.message || String(error),
        digest: error?.digest,
        stack: error?.stack,
        scope: "dashboard",
      }
      const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
      localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...prev].slice(0, 10)))
    } catch {
      /* yoksay */
    }
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 text-center">
        <h2 className="text-xl font-bold">Bu sayfa yüklenemedi</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Menüden başka bir sayfaya geçebilir ya da tekrar deneyebilirsiniz.
        </p>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
          {[`Mesaj : ${error?.message || "-"}`, error?.digest ? `Digest: ${error.digest}` : null]
            .filter(Boolean)
            .join("\n")}
        </pre>
        <Button className="mt-4" onClick={reset}>
          Tekrar Dene
        </Button>
      </div>
    </div>
  )
}
