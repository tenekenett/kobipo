"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Script from "next/script"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, RefreshCcw } from "lucide-react"

type PackageOrder = {
  id: string
  planName: string | null
  resolvedModules: string[]
  branchQuota: number
  billingCycle: string
  amount: string | number
  currency: string
  status: string
  paymentError?: string | null
}

declare global {
  interface Window {
    iFrameResize?: (opts: Record<string, unknown>, target: string) => void
  }
}

const tl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" })

export default function AbonelikOdemePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = params?.id
  const companySlug = searchParams.get("company") || ""
  const returnedFromPaytr = searchParams.get("odeme") // "ok" | "fail" | null

  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [loadingToken, setLoadingToken] = useState(true)
  const [order, setOrder] = useState<PackageOrder | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const backHref = `/ayarlar/abonelik${companySlug ? `?company=${encodeURIComponent(companySlug)}` : ""}`
  const isActive = order?.status === "ACTIVE"
  const isFailed = order?.status === "FAILED" || order?.status === "CANCELLED"

  const fetchToken = useCallback(async () => {
    if (!orderId) return
    setLoadingToken(true)
    setTokenError(null)
    try {
      const res = await fetch(`/api/billing/orders/${orderId}/paytr-token`, { method: "POST" })
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
    if (!companySlug || !orderId) return
    try {
      const res = await fetch(`/api/billing/orders?companyId=${encodeURIComponent(companySlug)}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      const found = Array.isArray(data?.data)
        ? (data.data as PackageOrder[]).find((o) => o.id === orderId)
        : null
      if (found) setOrder(found)
    } catch {
      /* sessizce yut; bir sonraki tur tekrar dener */
    }
  }, [companySlug, orderId])

  // İlk yükleme: PayTR'dan dönmediyse token al; her hâlde durumu yoklamaya başla.
  useEffect(() => {
    // ?odeme=ok/fail ile dönüşte YENİ token isteme — callback otoritedir; ikinci token isteği
    // "merchant_oid daha önce kullanılmış" hatasına düşerdi. Yalnızca siparişin durumunu yokla.
    if (returnedFromPaytr) {
      setLoadingToken(false)
    } else {
      fetchToken()
    }
    pollOrder()
  }, [fetchToken, pollOrder, returnedFromPaytr])

  // Sipariş ACTIVE/FAILED olana kadar durumu periyodik kontrol et (callback otoritedir).
  useEffect(() => {
    if (isActive || isFailed) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(pollOrder, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isActive, isFailed, pollOrder])

  // Abonelik aktifleşince server bileşenlerini (dashboard layout → nav'ın okuduğu entitlement'lar)
  // bir kez tazele; aksi halde açılan modüller ancak tam sayfa yenilemede navbar'a düşer.
  const refreshedRef = useRef(false)
  useEffect(() => {
    if (isActive && !refreshedRef.current) {
      refreshedRef.current = true
      router.refresh()
    }
  }, [isActive, router])

  const cycleLabel = order?.billingCycle === "YEARLY" ? "Yıllık" : "Aylık"

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Aboneliğe dön
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Kart ile Ödeme</CardTitle>
          {order && (
            <p className="text-sm text-muted-foreground">
              {order.planName || "Özel paket"} · {cycleLabel} ·{" "}
              <span className="font-semibold text-foreground">
                {tl.format(Number(order.amount))}
              </span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {isActive ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              <p className="text-lg font-semibold">Ödeme alındı, aboneliğiniz aktif 🎉</p>
              <p className="text-sm text-muted-foreground">
                Seçtiğiniz modüller ana firma ve tüm şubeleriniz için açıldı.
              </p>
              <Button asChild className="mt-2">
                <Link href={backHref}>Aboneliğe dön</Link>
              </Button>
            </div>
          ) : isFailed ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500" />
              <p className="text-lg font-semibold">
                {order?.status === "CANCELLED" ? "Sipariş iptal edildi" : "Ödeme tamamlanamadı"}
              </p>
              <p className="text-sm text-muted-foreground">
                {order?.paymentError ||
                  "Ödeme sırasında bir sorun oluştu. Aboneliğe dönüp yeniden deneyebilirsiniz."}
              </p>
              <Button asChild variant="outline" className="mt-2">
                <Link href={backHref}>Aboneliğe dön</Link>
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
          ) : returnedFromPaytr && !iframeUrl ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Ödemeniz doğrulanıyor… Bu sayfa otomatik güncellenecek.
              </p>
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
