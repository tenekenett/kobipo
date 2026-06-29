"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  Coins,
  Loader2,
  RefreshCw,
  ShoppingCart,
  XCircle,
} from "lucide-react"
import { KontorPurchaseDialog } from "@/components/e-donusum/kontor-purchase-dialog"
import { KontorActiveOrders } from "@/components/e-donusum/kontor-active-orders"

interface CreditRow {
  remainingCreditQty: number
  creditQty: number
  usedCreditQty: number
  endDate: string | null
  isExpired: boolean
  productLabel: string
}

interface UsageRow {
  productLabel: string
  usedCreditQty: number
}

export default function KontorPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")

  const [credit, setCredit] = useState<CreditRow[] | null>(null)
  const [creditUsage, setCreditUsage] = useState<UsageRow[]>([])
  const [creditLoading, setCreditLoading] = useState(false)
  const [creditError, setCreditError] = useState<string | null>(null)
  // VKN doğrulanmamışsa kredi endpoint'i 412 döner — satın alma/yenile yerine
  // kullanıcıyı E-Dönüşüm Ayarları'na yönlendiririz.
  const [needsVerification, setNeedsVerification] = useState(false)
  // Yeni sipariş sonrası "Devam eden siparişiniz" bölümünü tazelemek için.
  const [orderRefreshKey, setOrderRefreshKey] = useState(0)

  useEffect(() => {
    if (!companyId) return
    fetchCredit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const fetchCredit = async () => {
    if (!companyId) return
    setCreditLoading(true)
    setCreditError(null)
    setNeedsVerification(false)
    try {
      const res = await fetch(`/api/e-donusum/credit?companyId=${companyId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 412 → VKN doğrulanmamış. Ayarlara yönlendir.
        if (res.status === 412) setNeedsVerification(true)
        throw new Error(data?.error || "Kontör bilgisi alınamadı")
      }
      setCredit(Array.isArray(data?.data) ? data.data : [])
      setCreditUsage(Array.isArray(data?.usage) ? data.usage : [])
    } catch (error) {
      setCredit(null)
      setCreditUsage([])
      setCreditError(error instanceof Error ? error.message : "Kontör bilgisi alınamadı")
    } finally {
      setCreditLoading(false)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kontör</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const activeCredit = (credit || []).filter((c) => !c.isExpired)
  const totalRemaining = activeCredit.reduce((sum, c) => sum + (c.remainingCreditQty || 0), 0)
  const hasCredit = activeCredit.length > 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Kontör</h1>
        <p className="text-sm text-muted-foreground">
          E-Belge kontör bakiyenizi görüntüleyin ve yeni kontör satın alın
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <Coins className="h-4 w-4" />
              </span>
              <div>
                <CardTitle>Kontör Bilgisi</CardTitle>
                <CardDescription>
                  Mysoft hesabınızdaki kalan e-Belge kontör (kullanım hakkı) miktarı
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCredit}
              disabled={creditLoading}
              type="button"
            >
              {creditLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">Yenile</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {creditLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Kontör bilgisi yükleniyor…
            </div>
          ) : needsVerification ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Kontör bilgisini görüntülemek için önce{" "}
                <Link
                  href={`/ayarlar/firma?company=${companyId}`}
                  className="font-semibold underline underline-offset-2"
                >
                  Firma Ayarları
                </Link>{" "}
                sayfasından firma VKN/TCKN bilginizi girin.
              </p>
            </div>
          ) : creditError ? (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{creditError}</p>
            </div>
          ) : (
            <>
              {/* Hero: toplam kalan kontör (her zaman) */}
              <div className="rounded-lg border bg-emerald-50/60 p-4 dark:bg-emerald-950/20">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Toplam kalan kontör
                </span>
                <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-300">
                  {totalRemaining.toLocaleString("tr-TR")}
                </p>
                {!hasCredit && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aktif kontör paketiniz yok. Satın aldığınızda kalan bakiye burada görünür.
                  </p>
                )}
              </div>

              {/* Paket kırılımı (kontör varsa) — her paket için harcanan / kalan ayrı ayrı */}
              {hasCredit && (
                <div className="space-y-2">
                  {activeCredit.map((c, idx) => {
                    const total = c.creditQty || 0
                    const used = c.usedCreditQty || 0
                    const remaining = c.remainingCreditQty || 0
                    const usedPct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
                    return (
                      <div key={idx} className="space-y-2 rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant="secondary">{c.productLabel}</Badge>
                          {c.endDate && (
                            <span className="text-xs text-muted-foreground">
                              Geçerlilik:{" "}
                              {new Date(c.endDate).toLocaleDateString("tr-TR", { dateStyle: "medium" })}
                            </span>
                          )}
                        </div>
                        {/* Harcanan / toplam — "7 / 10" olarak, etiketli */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Harcanan:{" "}
                            <span className="font-semibold text-foreground">
                              {used.toLocaleString("tr-TR")} / {total.toLocaleString("tr-TR")}
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            Kalan:{" "}
                            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                              {remaining.toLocaleString("tr-TR")}
                            </span>
                          </span>
                        </div>
                        {/* İlerleme çubuğu: harcanan oranı */}
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                            style={{ width: `${usedPct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Kontör nereye harcandı? — ürün bazında tüketim dökümü (her zaman görünür) */}
              {creditUsage.length > 0 && (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Kontör nereye harcandı?
                  </p>
                  <div className="space-y-1.5">
                    {creditUsage.map((u, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{u.productLabel}</span>
                        <span className="font-medium">
                          {u.usedCreditQty.toLocaleString("tr-TR")} adet
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Devam eden siparişler — süreç burada görünür (kullanılanın altında) */}
              <KontorActiveOrders companyId={companyId} refreshKey={orderRefreshKey} />

              {/* Satın al CTA */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Havale onayından sonra hesabınıza otomatik yüklenir.
                </p>
                <KontorPurchaseDialog
                  companyId={companyId}
                  onPurchased={() => {
                    fetchCredit()
                    setOrderRefreshKey((k) => k + 1)
                  }}
                  trigger={
                    <Button type="button">
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Kontör Satın Al
                    </Button>
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
