"use client"

// Adisyonlar — seçilen GÜNÜN adisyonları + o an açık olan hesaplar.
// Kararlar: docs/restoran/SATIS-EKRANI.md §4.7
//
// (Adisyonun KENDİSİ ticket-screen.tsx; burası liste.)
//
// Salon planı MASAYA bakar; masası olmayan (paket/gel-al) adisyon orada hiç
// görünmez, kapanmış adisyon ise hiçbir yerde görünmüyordu — gün sonu raporu
// fişleri sayar, adisyonları değil. Bu ekran iki soruya birden cevap verir:
// "şu an hangi hesap açık" ve "bu gün ne kesildi".
//
// İki liste bilinçli olarak BİRLEŞTİRİLİYOR: dünden sarkan açık masa bugünün
// gün listesinde yoktur (açılışı düne düşer) ama hâlâ tahsil edilmeyi bekler,
// bu yüzden bugüne bakarken de görünmek zorunda.

import { useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  RefreshCw,
  Search,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { CompanyLink } from "@/components/dashboard/company-link"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { NewTicketDialog } from "@/components/restoran/new-ticket-dialog"
import { useDayTickets, useOpenTickets, useTables, type Ticket } from "@/lib/swr/use-restoran"
import { currency } from "@/lib/fis/receipt-html"
import { cn } from "@/lib/utils"
import { WriteAction } from "@/components/dashboard/write-guard"

type SortKey = "time" | "amount"
type StatusFilter = "ALL" | "OPEN" | "CLOSED" | "CANCELLED"

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

const shiftDay = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number)
  return isoDay(new Date(y, (m ?? 1) - 1, (d ?? 1) + delta))
}

const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    weekday: "short",
  })
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })

const minutesSince = (iso: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))

const elapsed = (mins: number) =>
  mins < 60 ? `${mins} dk` : `${Math.floor(mins / 60)} sa ${mins % 60} dk`

const FILTERS: Array<[StatusFilter, string]> = [
  ["ALL", "Tümü"],
  ["OPEN", "Açık"],
  ["CLOSED", "Kapanan"],
  ["CANCELLED", "İptal"],
]

export function TicketsScreen() {
  const { selectedCompanyId: companyId } = useDashboardCompany()

  const [day, setDay] = useState(() => isoDay(new Date()))
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("time")
  const [status, setStatus] = useState<StatusFilter>("ALL")
  const [newOpen, setNewOpen] = useState(false)

  const today = isoDay(new Date())
  const isToday = day === today
  const now = Date.now()

  const dayQuery = useDayTickets(companyId, day)
  // Açık hesaplar yalnız BUGÜNE bakarken eklenir: geçmiş bir güne bakarken
  // bugünün açık masasını göstermek listeyi yalan söyletirdi. O günün kendi
  // açık adisyonları zaten gün sorgusundan (`status=ALL`) geliyor.
  const openQuery = useOpenTickets(isToday ? companyId : null)
  const tableQuery = useTables(companyId)

  const refresh = () => {
    void dayQuery.mutate()
    void openQuery.mutate()
    void tableQuery.mutate()
  }

  const all = useMemo(() => {
    const byId = new Map<string, Ticket>()
    for (const t of dayQuery.tickets) byId.set(t.id, t)
    // Dünden sarkan açık hesaplar — gün listesinde yoklar, sona eklenirler.
    for (const t of openQuery.tickets) byId.set(t.id, t)
    return [...byId.values()]
  }, [dayQuery.tickets, openQuery.tickets])

  const counts = useMemo(() => {
    const c = { ALL: all.length, OPEN: 0, CLOSED: 0, CANCELLED: 0 }
    for (const t of all) {
      if (t.status === "OPEN") c.OPEN += 1
      else if (t.status === "CLOSED") c.CLOSED += 1
      else if (t.status === "CANCELLED") c.CANCELLED += 1
    }
    return c
  }, [all])

  // Listede olup o gün KESİLMEMİŞ adisyonlar (dünden sarkan açık hesaplar).
  // Sayılmazsa "06 Ağustos · 1 adisyon" o gün bir adisyon kesildiği anlamına
  // gelirdi; oysa kesilmedi, önceki günden bir hesap hâlâ açık duruyor.
  const carriedOver = useMemo(
    () => all.filter((t) => isoDay(new Date(t.openedAt)) !== day).length,
    [all, day],
  )

  const totals = useMemo(() => {
    let open = 0
    let closed = 0
    for (const t of all) {
      if (t.status === "OPEN") open += t.totals.total
      else if (t.status === "CLOSED") closed += t.totals.total
    }
    return { open, closed }
  }, [all])

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    const filtered = all.filter((t) => {
      if (status !== "ALL" && t.status !== status) return false
      if (!q) return true
      return [t.code, t.tableName, t.customerName, t.note, t.invoiceNo]
        .filter(Boolean)
        .some((v) => (v as string).toLocaleLowerCase("tr-TR").includes(q))
    })

    return filtered.sort((a, b) => {
      // Açık hesap her zaman üstte: liste önce "ne bekliyor"u söyler, sonra
      // "ne oldu"yu.
      const rank = (t: Ticket) => (t.status === "OPEN" ? 0 : 1)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      if (sort === "amount") return b.totals.total - a.totals.total
      const at = new Date(a.openedAt).getTime()
      const bt = new Date(b.openedAt).getTime()
      // Açıkta en ESKİ üstte (en uzun bekleyen hesap dikkat ister), kapananda
      // en YENİ üstte (az önce ne kapandı).
      return a.status === "OPEN" ? at - bt : bt - at
    })
  }, [all, search, sort, status])

  const error = dayQuery.error ?? openQuery.error
  const isLoading = dayQuery.isLoading || openQuery.isLoading

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
          <h1 className="text-3xl font-bold">Adisyonlar</h1>
          <p className="text-muted-foreground">
            Seçilen günde kesilen adisyonlar ve açık duran hesaplar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Yenile
          </Button>
          <WriteAction>
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Yeni adisyon
            </Button>
          </WriteAction>
        </div>
      </div>

      {/* Gün seçimi */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setDay((d) => shiftDay(d, -1))}
            aria-label="Önceki gün"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[120px] px-1 text-center text-sm font-semibold">
            {dayLabel(day)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={isToday}
            onClick={() => setDay((d) => shiftDay(d, 1))}
            aria-label="Sonraki gün"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Input
          type="date"
          value={day}
          max={today}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="h-9 w-40"
        />
        {!isToday && (
          <Button variant="outline" size="sm" onClick={() => setDay(today)}>
            Bugün
          </Button>
        )}
      </div>

      {/* Özet */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Adisyon</p>
            <p className="text-2xl font-bold tabular-nums">{counts.ALL - carriedOver}</p>
            {carriedOver > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                + {carriedOver} önceki günden açık
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Kapanan ({counts.CLOSED})</p>
            <p className="text-2xl font-bold tabular-nums">{currency(totals.closed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Açık hesap ({counts.OPEN})</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {currency(totals.open)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtreler */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Masa, adisyon no, müşteri, fiş no…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                status === value
                  ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {label} ({counts[value]})
            </button>
          ))}
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
      </div>

      {error ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            <FetchErrorText error={error} subject="Adisyonlar" />
          </CardContent>
        </Card>
      ) : isLoading && all.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Yükleniyor…
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {all.length === 0
              ? `${dayLabel(day)} için adisyon yok. Masadan ya da “Yeni adisyon” ile açabilirsiniz.`
              : "Bu filtreye uyan adisyon yok."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              now={now}
              day={day}
            />
          ))}
        </div>
      )}

      <NewTicketDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        tables={tableQuery.tables}
        onCreated={refresh}
      />
    </div>
  )
}

function TicketCard({
  ticket: t,
  now,
  day,
}: {
  ticket: Ticket
  now: number
  day: string
}) {
  const isOpen = t.status === "OPEN"
  const mins = minutesSince(t.openedAt, now)
  const itemCount = t.items
    .filter((i) => i.status === "NORMAL")
    .reduce((s, i) => s + i.quantity, 0)
  // Açık hesap listedeki günden ESKİYSE bunu söylemek gerekir: "2 gün önce
  // açılmış, hâlâ duruyor" unutulmuş masanın tek işareti.
  const fromEarlierDay = isOpen && isoDay(new Date(t.openedAt)) !== day

  // Gerçek <a>: kart `<button onClick={router.push}>` iken sağ tık → yeni
  // sekmede aç, orta tık ve link önizleme çalışmıyordu — iki adisyonu yan yana
  // karşılaştırmanın tek yolu bu. Liste AKTİF firmanın adisyonlarını gösterdiği
  // için CompanyLink doğru araç (CLAUDE.md'deki "farklı firma" istisnası yok).
  return (
    <CompanyLink
      href={`/restoran/adisyon/${t.id}`}
      className={cn(
        "block rounded-xl border bg-card p-3 text-left transition-colors hover:border-kobipo-blue dark:hover:border-primary",
        isOpen && "border-l-4 border-l-amber-400 dark:border-l-amber-500",
        t.status === "CANCELLED" && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {t.tableName ? `Masa ${t.tableName}` : "Paket / Gel-al"}
          </p>
          <p className="truncate text-xs text-muted-foreground">{t.code}</p>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={cn(
              "text-lg font-bold tabular-nums",
              t.status === "CANCELLED" && "line-through",
            )}
          >
            {currency(t.totals.total)}
          </span>
          <div className="mt-0.5">
            <StatusChip ticket={t} />
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {isOpen ? (
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
        ) : (
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {timeLabel(t.openedAt)}
            {t.closedAt ? ` – ${timeLabel(t.closedAt)}` : ""}
          </span>
        )}
        <span>{itemCount} kalem</span>
        {t.guestCount ? (
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {t.guestCount}
          </span>
        ) : null}
        {t.customerName ? <span className="truncate">{t.customerName}</span> : null}
        {t.invoiceNo ? <span className="truncate">{t.invoiceNo}</span> : null}
        {fromEarlierDay ? (
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            {timeLabel(t.openedAt)} · önceki günden
          </span>
        ) : null}
        {t.status === "CANCELLED" && !t.mergedIntoId && t.cancelReasonLabel ? (
          <span className="truncate">{t.cancelReasonLabel}</span>
        ) : null}
      </div>
    </CompanyLink>
  )
}

/** İptal ile BİRLEŞTİRME ayrı gösterilir: ikisi de `CANCELLED` durumundadır ama
 *  birleştirilenin cirosu kaybolmadı, hedef adisyona geçti. */
function StatusChip({ ticket: t }: { ticket: Ticket }) {
  const [label, tone] =
    t.status === "OPEN"
      ? ["Açık", "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"]
      : t.status === "CLOSED"
        ? ["Kapandı", "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"]
        : t.mergedIntoId
          ? ["Birleştirildi", "bg-muted text-muted-foreground"]
          : ["İptal", "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"]

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>
      {label}
    </span>
  )
}
