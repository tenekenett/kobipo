"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import Link from "next/link"
import Script from "next/script"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, RefreshCcw } from "lucide-react"

type KontorOrder = {
  id: string
  packageName: string
  creditQty: number
  totalPrice: string | number
  currency: string
  status: string
  paymentError?: string | null
  loadError?: string | null
}

declare global {
  interface Window {
    iFrameResize?: (opts: Record<string, unknown>, target: string) => void
  }
}

export default function KontorOdemePage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const orderId = params?.id
  const companyId = searchParams.get("company") || ""

  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [loadingToken, setLoadingToken] = useState(true)
  const [order, setOrder] = useState<KontorOrder | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isLoaded = order?.status === "LOADED"
  const isFailed = order?.status === "FAILED" || order?.status === "REJECTED"

  const fetchToken = useCallback(async () => {
    if (!orderId) return
    setLoadingToken(true)
    setTokenError(null)
    try {
      const res = await fetch(`/api/kontor/orders/${orderId}/paytr-token`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Ödeme başlatılamadı")
      setIframeUrl(data.iframeUrl as string)
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "Ödeme başlatılamadı")
    } finally {
      setLoadingToken(false)
    }
  }, [orderId])

  const pollOrder = useCallback(async () => {
    if (!companyId || !orderId) return
    try {
      const res = await fetch(`/api/kontor/orders?companyId=${encodeURIComponent(companyId)}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      const found = Array.isArray(data?.data)
        ? (data.data as KontorOrder[]).find((o) => o.id === orderId)
        : null
      if (found) setOrder(found)
    } catch {
      /* sessizce yut; bir sonraki tur tekrar dener */
    }
  }, [companyId, orderId])

  // İlk yükleme: token al + durumu okumaya başla.
  useEffect(() => {
    fetchToken()
    pollOrder()
  }, [fetchToken, pollOrder])

  // Sipariş LOADED/FAILED olana kadar durumu periyodik kontrol et (callback otoritedir).
  useEffect(() => {
    if (isLoaded || isFailed) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(pollOrder, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isLoaded, isFailed, pollOrder])

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link
        href="/e-donusum/kontor"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Kontör'e dön
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Kart ile Ödeme</CardTitle>
          {order && (
            <p className="text-sm text-muted-foreground">
              {order.packageName} · {order.creditQty.toLocaleString("tr-TR")} kontör ·{" "}
              <span className="font-semibold text-foreground">
                {Number(order.totalPrice).toLocaleString("tr-TR")} {order.currency}
              </span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {isLoaded ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              <p className="text-lg font-semibold">Ödeme alındı, kontör yüklendi 🎉</p>
              <p className="text-sm text-muted-foreground">
                Kontör bakiyeniz güncellendi. Detaylar Kontör sayfasında.
              </p>
              <Button asChild className="mt-2">
                <Link href="/e-donusum/kontor">Kontör'e dön</Link>
              </Button>
            </div>
          ) : isFailed ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500" />
              <p className="text-lg font-semibold">
                {order?.status === "FAILED" ? "Ödeme alındı ama yükleme tamamlanamadı" : "Sipariş reddedildi"}
              </p>
              <p className="text-sm text-muted-foreground">
                {order?.loadError ||
                  "Ekibimiz durumu görebiliyor; kısa sürede tamamlanacaktır. Sorun sürerse destekle iletişime geçin."}
              </p>
              <Button asChild variant="outline" className="mt-2">
                <Link href="/e-donusum/kontor">Kontör'e dön</Link>
              </Button>
            </div>
          ) : tokenError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="h-10 w-10 text-destructive" />
              <p className="font-semibold">{tokenError}</p>
              <Button onClick={fetchToken} variant="outline">
                <RefreshCcw className="mr-1.5 h-4 w-4" />
                Tekrar dene
              </Button>
            </div>
          ) : loadingToken || !iframeUrl ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Ödeme ekranı hazırlanıyor…
            </div>
          ) : (
            <div className="space-y-3">
              <iframe
                src={iframeUrl}
                id="paytriframe"
                frameBorder={0}
                scrolling="no"
                style={{ width: "100%", minHeight: 480 }}
                title="PayTR Ödeme"
              />
              <Script
                src="https://www.paytr.com/js/iframeResizer.min.js"
                strategy="afterInteractive"
                onLoad={() => window.iFrameResize?.({}, "#paytriframe")}
              />
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Ödeme tamamlanınca bu sayfa otomatik güncellenir.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
