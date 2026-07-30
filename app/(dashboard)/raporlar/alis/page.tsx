"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowUpRight, Receipt, TrendingDown, UserRound } from "lucide-react"
import { ExportButton } from "@/components/export/export-button"

interface Invoice {
  id: string
  invoiceNo: string
  type: string
  status: string
  date: string
  totalAmount: number | string
  customer?: { name?: string | null } | null
  supplier?: { name?: string | null } | null
}

const monthLabel = (date: Date) =>
  date.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" })

export default function AlisRaporlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setIsLoading(true)
    fetch(`/api/e-donusum/invoices?companyId=${companyId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Invoice[]) => {
        if (!cancelled) setInvoices(Array.isArray(data) ? data : [])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  const purchases = useMemo(() => invoices.filter((i) => i.type === "PURCHASE"), [invoices])
  const totalAmount = useMemo(
    () => purchases.reduce((sum, i) => sum + Number(i.totalAmount || 0), 0),
    [purchases]
  )

  const monthly = useMemo(() => {
    const map = new Map<string, { label: string; amount: number; count: number; sort: number }>()
    purchases.forEach((i) => {
      const d = new Date(i.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const cur = map.get(key) ?? { label: monthLabel(d), amount: 0, count: 0, sort: d.getTime() }
      cur.amount += Number(i.totalAmount || 0)
      cur.count += 1
      map.set(key, cur)
    })
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort)
  }, [purchases])

  const topSuppliers = useMemo(() => {
    const map = new Map<string, number>()
    purchases.forEach((i) => {
      const name = i.supplier?.name?.trim() || "Bilinmeyen"
      map.set(name, (map.get(name) ?? 0) + Number(i.totalAmount || 0))
    })
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [purchases])

  const maxMonthly = Math.max(0, ...monthly.map((m) => m.amount))

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Alış Raporları</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Alış Raporları</h1>
          <p className="text-sm text-muted-foreground">
            Alış fatura, masraf ve tedarikçi analizi için özet veriler
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton dataset="rapor-alis" companyId={companyId} size="default" />
          <Link href={`/alis/fatura?company=${encodeURIComponent(companyId)}`}>
            <Button variant="outline">
              Tüm alış faturaları
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Toplam Alış</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                ₺{totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <span className="rounded-xl bg-red-50 p-2.5 text-red-600 dark:bg-red-950/30 dark:text-red-300">
              <TrendingDown className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fatura Adedi</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{purchases.length}</p>
            </div>
            <span className="rounded-xl bg-amber-100 p-2.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Receipt className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aktif Tedarikçi</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{topSuppliers.length}</p>
            </div>
            <span className="rounded-xl bg-kobipo-blue/10 p-2.5 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <UserRound className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aylık alış</CardTitle>
          <CardDescription>Fatura tarihine göre toplam</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : monthly.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Henüz alış kaydı yok</p>
          ) : (
            <div className="space-y-2.5">
              {monthly.map((m) => {
                const pct = maxMonthly > 0 ? Math.round((m.amount / maxMonthly) * 100) : 0
                return (
                  <div key={m.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{m.label}</span>
                      <span className="font-mono tabular-nums">
                        ₺{m.amount.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                        <span className="ml-2 text-muted-foreground">{m.count} fatura</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-red-400 to-red-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>En çok alış yapılan tedarikçiler</CardTitle>
          <CardDescription>İlk 5</CardDescription>
        </CardHeader>
        <CardContent>
          {topSuppliers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Veri yok</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {topSuppliers.map(([name, amount], idx) => (
                <li key={name} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold tabular-nums">
                      {idx + 1}
                    </span>
                    <p className="truncate font-medium">{name}</p>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    ₺{amount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
