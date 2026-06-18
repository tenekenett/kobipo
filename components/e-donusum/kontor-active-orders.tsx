"use client"

import { useEffect, useState } from "react"
import { Check, XCircle, Clock, Copy } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

// Havale/EFT ödeme bilgileri — gerçek IBAN ile değiştirin (ya da ileride sistem ayarından okuyun).
export const HAVALE_INFO = {
  unvan: "REYPO BİLİŞİM SANAYİ VE TİCARET LTD. ŞTİ.",
  iban: "TR00 0000 0000 0000 0000 0000 00",
}

interface KontorOrder {
  id: string
  packageName: string
  totalPrice: string | number
  currency: string
  status: string
}

const STEPS = ["Sipariş", "Havale", "Onay", "Yüklendi"]

function statusToStep(status: string): { current: number; failed: boolean } {
  switch (status) {
    case "PENDING_PAYMENT":
      return { current: 1, failed: false }
    case "PAYMENT_REVIEW":
      return { current: 2, failed: false }
    case "LOADED":
      return { current: 4, failed: false }
    case "FAILED":
      return { current: 3, failed: true }
    default:
      return { current: 0, failed: false }
  }
}

export function OrderStepper({ status }: { status: string }) {
  const { current, failed } = statusToStep(status)
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const done = i < current
        const active = i === current && !failed
        const isFail = failed && i === current
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                  done
                    ? "bg-emerald-500 text-white"
                    : isFail
                      ? "bg-red-500 text-white"
                      : active
                        ? "bg-kobipo-blue text-white dark:bg-primary"
                        : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {done ? <Check className="h-4 w-4" /> : isFail ? <XCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={[
                  "mt-1 text-[10px]",
                  done || active ? "font-medium text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-1 h-0.5 flex-1 ${i < current ? "bg-emerald-500" : "bg-muted"}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Firmanın devam eden (ödeme/onay bekleyen) kontör siparişlerini adım çubuğu + havale
 * bilgileriyle gösterir. Aktif sipariş yoksa hiçbir şey render etmez.
 * `refreshKey` değiştiğinde (ör. yeni sipariş sonrası) yeniden çeker.
 */
export function KontorActiveOrders({
  companyId,
  refreshKey,
}: {
  companyId: string
  refreshKey?: number
}) {
  const { toast } = useToast()
  const [orders, setOrders] = useState<KontorOrder[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/kontor/orders?companyId=${companyId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!cancelled && r.ok && Array.isArray(d?.data)) setOrders(d.data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [companyId, refreshKey])

  const active = orders.filter(
    (o) => o.status === "PENDING_PAYMENT" || o.status === "PAYMENT_REVIEW",
  )
  if (active.length === 0) return null

  const copyIban = () => {
    navigator.clipboard?.writeText(HAVALE_INFO.iban.replace(/\s/g, ""))
    toast({ title: "IBAN kopyalandı" })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Devam eden siparişiniz
      </p>
      {active.map((o) => (
        <div key={o.id} className="rounded-xl border bg-muted/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{o.packageName}</span>
            <span className="text-sm text-muted-foreground">
              {Number(o.totalPrice).toLocaleString("tr-TR")} {o.currency}
            </span>
          </div>
          <OrderStepper status={o.status} />
          {o.status === "PENDING_PAYMENT" && (
            <div className="mt-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
              <p className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
                <Clock className="h-4 w-4" /> Havale / EFT yapın
              </p>
              <p className="text-amber-900/90 dark:text-amber-200/90">{HAVALE_INFO.unvan}</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-amber-900 dark:text-amber-200">{HAVALE_INFO.iban}</span>
                <button onClick={copyIban} className="text-amber-700 hover:text-amber-900 dark:text-amber-300">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                Açıklamaya sipariş no yazın: <span className="font-mono">{o.id}</span>
              </p>
            </div>
          )}
          {o.status === "PAYMENT_REVIEW" && (
            <p className="mt-3 text-xs text-muted-foreground">
              Ödemeniz alındı, onay bekleniyor. Onaylanınca kontör otomatik yüklenecek.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
