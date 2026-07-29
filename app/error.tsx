"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

/**
 * Uygulama geneli hata sınırı.
 *
 * ÖNEMLİ: Burası önceden `error` nesnesini hiç almıyordu (yalnız `reset`), bu yüzden
 * bir hata oluştuğunda hiçbir yerde iz kalmıyordu. Sayfalar arası geçişte anlık
 * beliren "beyaz ekran" bu sınırdı ve kendini toparladığı için kullanıcı hatayı
 * yakalayamıyordu. Artık:
 *   - console'a tam hata + digest basılır,
 *   - son 10 hata localStorage'a yazılır (flash geçse de kayıt kalır),
 *   - digest ekranda gösterilir → Vercel loglarındaki sunucu hatasıyla eşleştirilir.
 */

const STORAGE_KEY = "kobipo:client-errors"

export type StoredClientError = {
  at: string
  url: string
  message: string
  digest?: string
  stack?: string
}

/** Kayıtlı istemci hatalarını okur (konsoldan: JSON.parse(localStorage['kobipo:client-errors'])). */
export function readStoredClientErrors(): StoredClientError[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch {
    return []
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Konsol: "Preserve log" açıkken sayfa geçişinde de kalır.
    console.error("[Kobipo] Sayfa hatası:", error)
    try {
      const entry: StoredClientError = {
        at: new Date().toISOString(),
        url: typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
        message: error?.message || String(error),
        digest: error?.digest,
        stack: error?.stack,
      }
      const prev: StoredClientError[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
      localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...prev].slice(0, 10)))
    } catch {
      /* localStorage yoksa/doluysa sessizce geç — hata ekranını bozma */
    }
  }, [error])

  const details = [
    `Mesaj : ${error?.message || "-"}`,
    error?.digest ? `Digest: ${error.digest}` : null,
    typeof window !== "undefined" ? `Sayfa : ${window.location.pathname + window.location.search}` : null,
    `Zaman : ${new Date().toLocaleString("tr-TR")}`,
  ]
    .filter(Boolean)
    .join("\n")

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <h2 className="text-2xl font-bold">Bir hata oluştu</h2>
        <p className="mt-2 text-muted-foreground">Lütfen tekrar deneyin.</p>

        {/* Destek için: hatanın kimliği ekranda kalsın ki kullanıcı iletebilsin. */}
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
          {details}
        </pre>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>Tekrar Dene</Button>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(details).then(
                () => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                },
                () => setCopied(false),
              )
            }}
          >
            {copied ? "Kopyalandı" : "Hata bilgisini kopyala"}
          </Button>
        </div>
      </div>
    </div>
  )
}
