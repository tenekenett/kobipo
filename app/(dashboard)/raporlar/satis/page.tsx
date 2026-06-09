"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowUpRight, Receipt, TrendingUp, Users } from "lucide-react"

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

export default function SatisRaporlariPage() {
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

  const sales = useMemo(() => invoices.filter((i) => i.type === "SALES"), [invoices])
  const totalAmount = useMemo(
    () => sales.reduce((sum, i) => sum + Number(i.totalAmount || 0), 0),
    [sales]
  )

  const monthly = useMemo(() => {
    const map = new Map<string, { label: string; amount: number; count: number; sort: number }>()
    sales.forEach((i) => {
      const d = new Date(i.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const cur = map.get(key) ?? { label: monthLabel(d), amount: 0, count: 0, sort: d.getTime() }
      cur.amount += Number(i.totalAmount || 0)
      cur.count += 1
      map.set(key, cur)
    })
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort)
  }, [sales])

  const topCustomers = useMemo(() => {
    const map = new Map<string, number>()
    sales.forEach((i) => {
      const name = i.customer?.name?.trim() || "Bilinmeyen"
      map.set(name, (map.get(name) ?? 0) + Number(i.totalAmount || 0))
    })
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [sales])

  const maxMonthly = Math.max(0, ...monthly.map((m) => m.amount))

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Satış Raporları</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Satış Raporları</h1>
          <p className="text-sm text-muted-foreground">
            Fatura, detay, iade ve satışçı performansı için özet veriler
          </p>
        </div>
        <Link href={`/satis/fatura?company=${encodeURIComponent(companyId)}`}>
          <Button variant="outline">
            Tüm satış faturaları
            <ArrowUpRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Toplam Satış</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                ₺{totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <span className="rounded-xl bg-kobipo-blue/10 p-2.5 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <TrendingUp className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fatura Adedi</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{sales.length}</p>
            </div>
            <span className="rounded-xl bg-amber-100 p-2.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Receipt className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aktif Müşteri</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{topCustomers.length}</p>
            </div>
            <span className="rounded-xl bg-kobipo-green/10 p-2.5 text-kobipo-green-dark dark:bg-emerald-900/30 dark:text-emerald-300">
              <Users className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aylık satış</CardTitle>
          <CardDescription>Fatura tarihine göre toplam</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : monthly.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Henüz satış kaydı yok</p>
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
                        className="h-full rounded-full bg-gradient-to-r from-kobipo-blue to-kobipo-mid"
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
          <CardTitle>En çok satış yapılan müşteriler</CardTitle>
          <CardDescription>İlk 5</CardDescription>
        </CardHeader>
        <CardContent>
          {topCustomers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Veri yok</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {topCustomers.map(([name, amount], idx) => (
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
