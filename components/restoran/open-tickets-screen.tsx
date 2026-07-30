"use client"

// Açık adisyonlar — hesaba bakan liste.
// Kararlar: docs/restoran/SATIS-EKRANI.md §4.7
//
// Salon planı MASAYA bakar; masası olmayan (paket/gel-al) adisyon orada hiç
// görünmez. Model bunu baştan destekliyordu (`tableId` opsiyonel) ama açmanın
// bir yolu yoktu — bu ekran o boşluğu kapatıyor ve aynı zamanda "hangi hesap
// ne kadar süredir açık" sorusunun tek cevap yeri.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Clock, Loader2, Plus, RefreshCw, Search, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useOpenTickets } from "@/lib/swr/use-restoran"
import { currency } from "@/lib/fis/receipt-html"
import { cn } from "@/lib/utils"

type SortKey = "time" | "amount"

const minutesSince = (iso: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))

const elapsed = (mins: number) =>
  mins < 60 ? `${mins} dk` : `${Math.floor(mins / 60)} sa ${mins % 60} dk`

export function OpenTicketsScreen() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { tickets, error, isLoading, mutate } = useOpenTickets(companyId)
  const { toast } = useToast()
  const router = useRouter()

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("time")
  const [creating, setCreating] = useState(false)
  const now = Date.now()

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    const filtered = q
      ? tickets.filter((t) =>
          [t.code, t.tableName, t.customerName, t.note]
            .filter(Boolean)
            .some((v) => (v as string).toLocaleLowerCase("tr-TR").includes(q)),
        )
      : tickets
    return [...filtered].sort((a, b) =>
      sort === "amount"
        ? b.totals.total - a.totals.total
        : new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
    )
  }, [search, sort, tickets])

  const openTotal = rows.reduce((s, t) => s + t.totals.total, 0)

  /** Masasız adisyon — paket/gel-al. Model destekliyordu, girişi yoktu. */
  const openTakeaway = async () => {
    if (!companyId) return
    setCreating(true)
    try {
      const res = await fetch("/api/restoran/adisyonlar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Adisyon açılamadı")
      router.push(`/restoran/adisyon/${body.id}`)
    } catch (e: any) {
      toast({ title: "Adisyon açılamadı", description: e.message, variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Açık Adisyonlar</h1>
          <p className="text-muted-foreground">
            Masalı ve masasız (paket / gel-al) tüm açık hesaplar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void mutate()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Yenile
          </Button>
          <Button onClick={() => void openTakeaway()} disabled={creating}>
            {creating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            Paket / Gel-al
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Masa, adisyon no, müşteri…"
            className="pl-9"
          />
        </div>
        {(
          [
            ["time", "Süreye göre"],
            ["amount", "Tutara göre"],
          ] as Array<[SortKey, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSort(value)}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              sort === value
                ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                : "hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
        <span className="rounded-lg bg-muted px-3 py-2 text-sm">
          {rows.length} hesap · <strong>{currency(openTotal)}</strong>
        </span>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            <FetchErrorText error={error} subject="Açık adisyonlar" />
          </CardContent>
        </Card>
      ) : isLoading && tickets.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Yükleniyor…
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Açık adisyon yok. Masadan ya da yukarıdaki düğmeyle paket adisyonu açabilirsiniz.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => {
            const mins = minutesSince(t.openedAt, now)
            const itemCount = t.items
              .filter((i) => i.status === "NORMAL")
              .reduce((s, i) => s + i.quantity, 0)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => router.push(`/restoran/adisyon/${t.id}`)}
                className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-kobipo-blue dark:hover:border-primary"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {t.tableName ? `Masa ${t.tableName}` : "Paket / Gel-al"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{t.code}</p>
                  </div>
                  <span className="shrink-0 text-lg font-bold tabular-nums">
                    {currency(t.totals.total)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      // Uzun süredir açık hesap dikkat ister: unutulan masa,
                      // kapanmamış paket siparişi.
                      mins >= 120 && "font-semibold text-amber-600 dark:text-amber-400",
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {elapsed(mins)}
                  </span>
                  <span>{itemCount} kalem</span>
                  {t.guestCount ? (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {t.guestCount}
                    </span>
                  ) : null}
                  {t.customerName ? <span className="truncate">{t.customerName}</span> : null}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
