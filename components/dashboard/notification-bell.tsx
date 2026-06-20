"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  Loader2,
  XCircle,
} from "lucide-react"

type Notification = {
  id: string
  title: string
  message: string
  type: string
  isRead: boolean
  link?: string | null
  createdAt: string
}

const TYPE_META: Record<
  string,
  { icon: typeof Info; className: string }
> = {
  INFO: { icon: Info, className: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300" },
  SUCCESS: { icon: CheckCircle2, className: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" },
  WARNING: { icon: AlertTriangle, className: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300" },
  ERROR: { icon: XCircle, className: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300" },
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "az önce"
  if (min < 60) return `${min} dk önce`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} sa önce`
  const day = Math.floor(hr / 24)
  if (day === 1) return "dün"
  if (day < 7) return `${day} gün önce`
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })
}

export function NotificationBell({ companyId }: { companyId?: string }) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)

  // Okunmamış sayısını periyodik çek (sekme görünürken).
  useEffect(() => {
    if (!companyId) {
      setCount(0)
      return
    }
    let cancelled = false
    let lastAt = 0
    const POLL = 5 * 60 * 1000
    const GAP = 30 * 1000

    const fetchCount = async (force = false) => {
      if (cancelled || document.visibilityState !== "visible") return
      const now = Date.now()
      if (!force && now - lastAt < GAP) return
      lastAt = now
      try {
        const res = await fetch(`/api/notifications?companyId=${companyId}&mode=count`, { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setCount(Number(data?.unreadCount || 0))
      } catch {
        /* sessiz */
      }
    }

    fetchCount(true)
    const interval = setInterval(() => fetchCount(false), POLL)
    const onVis = () => document.visibilityState === "visible" && fetchCount(false)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [companyId])

  const fetchList = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/notifications?companyId=${companyId}`, { cache: "no-store" })
      if (res.ok) setItems(await res.json())
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Dışarı tıklayınca kapat.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const togglePanel = () => {
    const next = !open
    setOpen(next)
    if (next) fetchList()
  }

  const markAllRead = async () => {
    if (!companyId) return
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setCount(0)
    try {
      await fetch(`/api/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, all: true }),
      })
    } catch {
      /* iyimser güncelleme */
    }
  }

  const handleClick = async (n: Notification) => {
    if (!n.isRead && companyId) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
      setCount((c) => Math.max(0, c - 1))
      fetch(`/api/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, id: n.id }),
      }).catch(() => {})
    }
    if (n.link) {
      const sep = n.link.includes("?") ? "&" : "?"
      const href = companyId && !n.link.includes("company=") ? `${n.link}${sep}company=${companyId}` : n.link
      setOpen(false)
      router.push(href)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="icon"
        type="button"
        className="relative h-9 w-9"
        title="Bildirimler"
        aria-expanded={open}
        onClick={togglePanel}
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-xl border border-kobipo-border bg-white shadow-lg dark:border-border dark:bg-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-kobipo-border px-4 py-2.5 dark:border-border">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Bildirimler</span>
              {count > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {count}
                </span>
              )}
            </div>
            {count > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-kobipo-blue hover:underline dark:text-primary"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Tümünü okundu işaretle
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Yükleniyor…
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <Bell className="h-7 w-7 opacity-40" />
                Henüz bildiriminiz yok
              </div>
            ) : (
              <ul className="divide-y divide-kobipo-border dark:divide-border">
                {items.map((n) => {
                  const meta = TYPE_META[n.type] ?? TYPE_META.INFO
                  const Icon = meta.icon
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => handleClick(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                          n.isRead ? "" : "bg-kobipo-pale/40 dark:bg-primary/5"
                        } ${n.link ? "cursor-pointer" : "cursor-default"}`}
                      >
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.className}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm ${n.isRead ? "font-medium" : "font-semibold"}`}>{n.title}</p>
                            {!n.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-kobipo-blue dark:bg-primary" />}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground/80">{relativeTime(n.createdAt)}</p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
