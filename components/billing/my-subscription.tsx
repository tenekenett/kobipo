"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  History,
  Loader2,
  Package,
  Users,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { MANAGEABLE_MODULES } from "@/lib/modules"
import { quotaHint, subscriptionBadge } from "@/lib/billing/subscription-view"

/** Uçtan gelen kota durumu ([[lib/billing/entitlements.ts]] → `QuotaStatus`). */
type QuotaStatus = {
  quota: number
  used: number
  remaining: number
  hasActiveSubscription: boolean
}

type MySubscription = {
  canManage: boolean
  recurringEnabled: boolean
  subscription: {
    status: string
    planName: string | null
    billingCycle: string | null
    amount: number | null
    periodStart: string | null
    periodEnd: string | null
    trialEndsAt: string | null
    lockedAt: string | null
    autoRenew: boolean
    cancelAtPeriodEnd: boolean
    autoRenewActive: boolean
    card: { brand: string | null; last4: string | null } | null
    purchasedModules: string[]
    isTrialActive: boolean
    isPaidActive: boolean
    isInGrace: boolean
  } | null
  notice: {
    kind: "expiring" | "grace" | "expired"
    endsAt: string
    locksAt: string
    daysLeft: number
    daysUntilLock: number
    cancelling: boolean
  } | null
  freeModules: string[]
  openModules: string[]
  quotas: { branch: QuotaStatus; company: QuotaStatus }
  orders: Array<{
    id: string
    status: string
    planName: string | null
    billingCycle: string
    amount: number
    discountCode: string | null
    discountAmount: number
    paidAt: string | null
    paymentError: string | null
    createdAt: string
    invoiceNo: string | null
    invoiceReady: boolean
  }>
  events: Array<{
    id: string
    type: string
    label: string
    summary: string
    actor: string
    createdAt: string
  }>
}

const tl = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 2,
})

const trDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : "—"

const trDateTime = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

const moduleLabel = (key: string) =>
  MANAGEABLE_MODULES.find((m) => m.key === key)?.label ?? key

const cycleLabel = (c: string | null | undefined) =>
  c === "YEARLY" ? "Yıllık" : c === "MONTHLY" ? "Aylık" : "—"

/** İki tarih arasındaki tam gün — "kalan gün" göstergesi. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

function QuotaRow({
  icon: Icon,
  label,
  status,
}: {
  icon: typeof Users
  label: string
  status: QuotaStatus
}) {
  const pct = status.quota > 0 ? Math.min(100, Math.round((status.used / status.quota) * 100)) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="font-medium tabular-nums">
          {/* Hak yokken "0" yerine "—": bkz. quotaHint — kota 0 çünkü abonelik yok,
              açık şubeler duruyor. */}
          {status.used} / {status.hasActiveSubscription ? status.quota : "—"}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-amber-500" : "bg-kobipo-blue"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{quotaHint(status)}</p>
    </div>
  )
}

/**
 * "Aboneliğim" — hesabın abonelik durumunun tek ekranı.
 *
 * Satın alma akışıyla AYNI sayfada durur (`/ayarlar/abonelik`): müşterinin "ne zaman
 * bitiyor" ile "nasıl uzatırım" soruları arka arkaya gelir, ikinci bir sayfa ikinci bir
 * gezinme ve ikinci bir istek demek olurdu.
 *
 * Veriyi katalogdan DEĞİL kendi ucundan alır ([[app/api/billing/subscription]]);
 * `onChanged` ile üst sayfanın kataloğunu tazeler, çünkü iptal/otomatik yenileme
 * satın alma formunun taban değerlerini de etkiler.
 */
export function MySubscription({
  companyParam,
  onChanged,
}: {
  companyParam: string
  onChanged?: () => void
}) {
  const key = companyParam
    ? `/api/billing/subscription?companyId=${encodeURIComponent(companyParam)}`
    : null
  const { data, error, isLoading, mutate } = useSWR<MySubscription>(key)

  const [busy, setBusy] = useState<null | "autoRenew" | "cancel">(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  async function post(url: string, body: Record<string, unknown>, kind: "autoRenew" | "cancel") {
    setBusy(kind)
    setActionError(null)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: companyParam, ...body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || "İşlem tamamlanamadı")
      await mutate()
      onChanged?.()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "İşlem tamamlanamadı")
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Abonelik bilgileriniz yükleniyor…
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Abonelik bilgileri okunamadı.
        </CardContent>
      </Card>
    )
  }

  const s = data.subscription
  const badge = s ? subscriptionBadge(s) : null
  const remaining = daysUntil(s?.periodEnd ?? s?.trialEndsAt ?? null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-kobipo-blue" />
              Aboneliğim
            </CardTitle>
            {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {!s ? (
            <p className="text-sm text-muted-foreground">
              Hesabınızda henüz bir abonelik yok. Aşağıdan bir paket seçerek başlayabilirsiniz.
            </p>
          ) : (
            <>
              {/* Dönem / periyot / tutar */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Paket</p>
                  <p className="text-sm font-medium">{s.planName || "Özel seçim"}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Periyot</p>
                  <p className="text-sm font-medium">{cycleLabel(s.billingCycle)}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Dönem tutarı</p>
                  <p className="text-sm font-medium">
                    {s.amount != null ? tl.format(s.amount) : "—"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Dönem:</span>
                  <span className="font-medium">
                    {trDate(s.periodStart)} – {trDate(s.periodEnd ?? s.trialEndsAt)}
                  </span>
                  {remaining != null && (
                    <span
                      className={`ml-auto text-xs font-semibold ${
                        remaining <= 0
                          ? "text-destructive"
                          : remaining <= 7
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {remaining > 0
                        ? `${remaining} gün kaldı`
                        : data.notice?.kind === "grace"
                          ? `Ödeme bekleniyor — ${Math.max(0, data.notice.daysUntilLock)} gün içinde kapanacak`
                          : "Süre doldu"}
                    </span>
                  )}
                </div>

                {/* Hoşgörü: dönem bitti ama erişim sürüyor. Kapanış tarihi dönem
                    bitişinden FARKLIDIR; müşteriye söylenmesi gereken tarih budur. */}
                {data.notice?.kind === "grace" && (
                  <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                    Ödemeniz alınamadı. Modülleriniz {trDate(data.notice.locksAt)} tarihine kadar
                    açık kalacak; bu tarihe kadar ödeme alınmazsa kapanır. Verileriniz silinmez.
                  </p>
                )}
                {s.cancelAtPeriodEnd && s.isPaidActive && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Aboneliğiniz iptal edildi; modülleriniz {trDate(s.periodEnd)} tarihinde
                    kapanacak. Otomatik yenilemeyi açarak iptali geri alabilirsiniz.
                  </p>
                )}
                {s.lockedAt && !s.isPaidActive && !s.isInGrace && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Erişim {trDate(s.lockedAt)} tarihinde kapandı. Verileriniz duruyor — yeni bir
                    dönem başlattığınızda kaldığınız yerden devam edersiniz.
                  </p>
                )}
              </div>

              {/* Otomatik yenileme + saklı kart */}
              {(s.isPaidActive || s.isInGrace) && (
                <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      Otomatik yenileme
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {!data.recurringEnabled
                        ? "Otomatik tahsilat şu anda kapalı — dönem sonunda yenilemeyi siz başlatırsınız."
                        : s.card?.last4
                          ? `Kayıtlı kart: ${s.card.brand || "Kart"} •••• ${s.card.last4}`
                          : // "Açık ama kayıtlı kart yok" en sık kaçan hâl: anahtar
                            // açıkken kimse tahsilat yapmaz, müşteri de bunu bilmez.
                            "Kayıtlı kart yok — bir sonraki ödemenizde kartınız saklanır."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {busy === "autoRenew" && <Loader2 className="h-4 w-4 animate-spin" />}
                    <Switch
                      checked={s.autoRenew}
                      disabled={!data.canManage || busy !== null}
                      onCheckedChange={(v) =>
                        post("/api/billing/subscription/auto-renew", { enabled: v }, "autoRenew")
                      }
                      aria-label="Otomatik yenileme"
                    />
                  </div>
                </div>
              )}

              {/* Açık modüller */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Açık modüller</p>
                {data.openModules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Açık modül yok. Aşağıdan paket veya modül seçerek açabilirsiniz.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.openModules.map((k) => {
                      const free = data.freeModules.includes(k)
                      return (
                        <span
                          key={k}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                            free
                              ? "bg-muted text-muted-foreground"
                              : "bg-kobipo-pale text-kobipo-blue"
                          }`}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {moduleLabel(k)}
                          {free && <span className="opacity-70">· Temel</span>}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Kota kullanımı — iki AYRI havuz (şube hakkı firma hakkını yemez). */}
              <div className="grid gap-4 sm:grid-cols-2">
                <QuotaRow icon={Users} label="Şube" status={data.quotas.branch} />
                <QuotaRow icon={Package} label="Ek firma" status={data.quotas.company} />
              </div>

              {actionError && <p className="text-sm text-destructive">{actionError}</p>}

              {data.canManage && s.isPaidActive && !s.cancelAtPeriodEnd && (
                <div className="flex justify-end border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Abonelik dönem sonunda iptal edilsin mi? Süre bitene kadar modülleriniz açık kalır.",
                        )
                      ) {
                        return
                      }
                      post("/api/billing/subscription/cancel", {}, "cancel")
                    }}
                  >
                    {busy === "cancel" ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        İptal ediliyor…
                      </>
                    ) : (
                      "Aboneliği iptal et"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ÖDEME GEÇMİŞİ */}
      {data.orders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-kobipo-blue" />
              Ödeme geçmişi
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tarih</th>
                    <th className="px-4 py-2 text-left font-medium">Açıklama</th>
                    <th className="px-4 py-2 text-right font-medium">Tutar</th>
                    <th className="px-4 py-2 text-left font-medium">Durum</th>
                    <th className="px-4 py-2 text-right font-medium">Fatura</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {trDate(o.paidAt || o.createdAt)}
                      </td>
                      <td className="px-4 py-2">
                        {o.planName || "Özel seçim"}
                        <span className="text-muted-foreground"> · {cycleLabel(o.billingCycle)}</span>
                        {o.discountCode && (
                          <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">
                            ({o.discountCode} · −{tl.format(o.discountAmount)})
                          </span>
                        )}
                        {o.status === "FAILED" && o.paymentError && (
                          <p className="text-xs text-destructive">{o.paymentError}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">
                        {tl.format(o.amount)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={
                            o.status === "ACTIVE"
                              ? "odendi"
                              : o.status === "FAILED"
                                ? "gecikti"
                                : "secondary"
                          }
                        >
                          {o.status === "ACTIVE"
                            ? "Ödendi"
                            : o.status === "FAILED"
                              ? "Başarısız"
                              : "İptal"}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {/* Buton yalnız GİB'e gönderilmiş fatura için: uç aksi halde
                            409 döndürür, tıklanan ama indirmeyen bir bağlantı bırakmayız. */}
                        {o.invoiceReady ? (
                          <a
                            href={`/api/billing/orders/${o.id}/invoice-pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-kobipo-blue hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {o.invoiceNo || "İndir"}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {o.status === "ACTIVE" ? "Hazırlanıyor" : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ABONELİK GEÇMİŞİ — "modüllerim neden kapandı" sorusunun cevabı. */}
      {data.events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-kobipo-blue" />
                Abonelik geçmişi
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {showHistory ? "Gizle" : `${data.events.length} kayıt · Göster`}
              </span>
            </button>
          </CardHeader>
          {showHistory && (
            <CardContent>
              <ol className="space-y-3">
                {data.events.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-kobipo-blue" />
                    <div className="min-w-0">
                      <p className="font-medium">{e.label}</p>
                      <p className="text-muted-foreground">{e.summary}</p>
                      <p className="text-xs text-muted-foreground/70">{trDateTime(e.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
