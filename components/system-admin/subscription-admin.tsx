"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, Search, RotateCcw, Lock, Unlock, XCircle, Building2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"

type Subscription = {
  id: string
  status: string
  provider: string
  purchasedModules: string[]
  branchQuota: number
  amount: string | number | null
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  billingCycle: string | null
  trialEndsAt: string | null
  periodEnd: string | null
}

type Order = {
  id: string
  status: string
  planName: string | null
  amount: string | number
  currency: string
  billingCycle: string
  resolvedModules: string[]
  branchQuota: number
  autoRenew: boolean
  paidAt: string | null
  paymentError: string | null
  createdAt: string
}

type Usage = {
  id: string
  key: string
  currentValue: number
  maxValue: number
  periodStart: string
  periodEnd: string
}

type Account = {
  id: string
  name: string
  slug: string
  disabledModules: string[]
  _count: { branches: number }
  subscriptions: Subscription[]
  packageOrders: Order[]
  usageLimits: Usage[]
}

const tl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" })
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("tr-TR") : "—")

const SUB_BADGE: Record<string, string> = {
  TRIAL: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  PAST_DUE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  CANCELLED: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  EXPIRED: "bg-red-500/15 text-red-300 border-red-500/30",
}
const ORDER_BADGE: Record<string, string> = {
  PENDING_PAYMENT: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  FAILED: "bg-red-500/15 text-red-300 border-red-500/30",
  CANCELLED: "bg-slate-500/15 text-slate-400 border-slate-600/40",
}

function Badge({ label, cls }: { label: string; cls?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls ?? "bg-slate-700/40 text-slate-300 border-slate-600/40"}`}>
      {label}
    </span>
  )
}

export function SubscriptionAdmin() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/billing/admin/overview", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      setAccounts(res.ok && Array.isArray(data?.data) ? data.data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR")
    if (!q) return accounts
    return accounts.filter(
      (a) => a.name.toLocaleLowerCase("tr-TR").includes(q) || a.slug.toLowerCase().includes(q),
    )
  }, [accounts, query])

  const resetAccount = async (acc: Account, mode: "trial" | "locked") => {
    const ok = await confirm({
      title: `${acc.name} — ${mode === "trial" ? "Taze deneme" : "Kilitli (satın almaya hazır)"}`,
      description:
        mode === "trial"
          ? "Siparişler ve kullanım sayaçları silinecek; 1 yıllık deneme kurulacak ve TÜM modüller açılacak. Şubeler dahildir."
          : "Siparişler ve kullanım sayaçları silinecek; abonelik EXPIRED yapılacak ve TÜM modüller kilitlenecek (satın alma akışı test edilebilir). Şubeler dahildir.",
      variant: "destructive",
    })
    if (!ok) return
    setBusyId(acc.id)
    try {
      const res = await fetch("/api/billing/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: acc.id, mode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Sıfırlama başarısız")
      toast({ title: "Sıfırlandı", description: `${acc.name} → ${mode === "trial" ? "taze deneme" : "kilitli"}` })
      await load()
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: e instanceof Error ? e.message : "Sıfırlama başarısız" })
    } finally {
      setBusyId(null)
    }
  }

  const cancelOrder = async (acc: Account, order: Order) => {
    const ok = await confirm({
      title: "Siparişi iptal et",
      description: `${order.planName || "Özel paket"} · ${tl.format(Number(order.amount))} — bu sipariş CANCELLED yapılacak.`,
      variant: "destructive",
    })
    if (!ok) return
    setBusyId(acc.id)
    try {
      const res = await fetch(`/api/billing/admin/orders/${order.id}/cancel`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "İptal başarısız")
      toast({ title: "Sipariş iptal edildi" })
      await load()
    } catch (e) {
      toast({ variant: "destructive", title: "Hata", description: e instanceof Error ? e.message : "İptal başarısız" })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Firma adı / slug ara…"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Yenile
        </button>
      </div>

      {loading && accounts.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Yükleniyor…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-400">
          Firma bulunamadı.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((acc) => (
            <AccountCard
              key={acc.id}
              acc={acc}
              busy={busyId === acc.id}
              onReset={resetAccount}
              onCancelOrder={cancelOrder}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AccountCard({
  acc,
  busy,
  onReset,
  onCancelOrder,
}: {
  acc: Account
  busy: boolean
  onReset: (acc: Account, mode: "trial" | "locked") => void
  onCancelOrder: (acc: Account, order: Order) => void
}) {
  const sub = acc.subscriptions[0] ?? null
  const openModules = acc.disabledModules.length === 0
  const orders = acc.packageOrders
  const pendingOrders = orders.filter((o) => o.status === "PENDING_PAYMENT")

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      {/* Başlık */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="font-semibold text-white">{acc.name}</span>
            <span className="text-xs text-slate-500">/{acc.slug}</span>
            {acc._count.branches > 0 && (
              <span className="text-xs text-slate-500">· {acc._count.branches} şube</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            {openModules ? (
              <span className="inline-flex items-center gap-1 text-emerald-400"><Unlock className="h-3 w-3" /> tüm modüller açık</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-400"><Lock className="h-3 w-3" /> kilitli: {acc.disabledModules.join(", ")}</span>
            )}
          </div>
        </div>

        {/* Aksiyonlar */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onReset(acc, "trial")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500/15 px-2.5 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
            title="Taze 1 yıllık deneme, tüm modüller açık"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Taze trial
          </button>
          <button
            onClick={() => onReset(acc, "locked")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
            title="Kullanımı sıfırla + modülleri kilitle (satın almaya hazır)"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
            Kilitle / sıfırla
          </button>
        </div>
      </div>

      {/* Abonelik */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
        {sub ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-300">
            <Badge label={sub.status} cls={SUB_BADGE[sub.status]} />
            <span className="text-slate-500">{sub.provider}</span>
            {sub.billingCycle && <span className="text-slate-400">{sub.billingCycle === "YEARLY" ? "Yıllık" : "Aylık"}</span>}
            {sub.amount != null && <span className="text-slate-400">{tl.format(Number(sub.amount))}</span>}
            <span className="text-slate-400">modüller: {sub.purchasedModules.length ? sub.purchasedModules.join(", ") : "—"}</span>
            <span className="text-slate-400">şube kotası: {sub.branchQuota}</span>
            <span className="text-slate-500">otoyenile: {sub.autoRenew ? "açık" : "kapalı"}{sub.cancelAtPeriodEnd ? " (iptal edilecek)" : ""}</span>
            <span className="text-slate-500">
              {sub.status === "TRIAL" ? `deneme bitiş: ${fmtDate(sub.trialEndsAt)}` : `dönem sonu: ${fmtDate(sub.periodEnd)}`}
            </span>
          </div>
        ) : (
          <span className="text-slate-500">Abonelik yok</span>
        )}
      </div>

      {/* Siparişler */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Siparişler ({orders.length}){pendingOrders.length > 0 && <span className="text-amber-400">· {pendingOrders.length} bekliyor</span>}
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-slate-500">Sipariş yok</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-slate-800/70">
                    <td className="py-1.5 pr-3"><Badge label={o.status} cls={ORDER_BADGE[o.status]} /></td>
                    <td className="py-1.5 pr-3 text-slate-300">{o.planName || "Özel paket"}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{tl.format(Number(o.amount))}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{o.billingCycle === "YEARLY" ? "Yıllık" : "Aylık"}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{o.resolvedModules.join(", ") || "—"}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{fmtDate(o.createdAt)}</td>
                    <td className="py-1.5 text-right">
                      {(o.status === "PENDING_PAYMENT" || o.status === "FAILED") && (
                        <button
                          onClick={() => onCancelOrder(acc, o)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/15 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> İptal
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Kullanım */}
      {acc.usageLimits.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Kullanım</div>
          <div className="flex flex-wrap gap-2">
            {acc.usageLimits.map((u) => (
              <span key={u.id} className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1 text-xs text-slate-400">
                {u.key}: {u.currentValue}/{u.maxValue} <span className="text-slate-600">({fmtDate(u.periodStart)})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
