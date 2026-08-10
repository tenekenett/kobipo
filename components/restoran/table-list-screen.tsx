"use client"

// Masa listesi — salon planının LİSTE hâli.
//
// Neden ayrı bir ekran: kroki masanın YERİNİ anlatır, servis sırasında ise
// yalnız ADI lazımdır ("M6'ya bir çay"). Krokide masa kutuları planın ölçeğine
// göre küçülüyor ve dokunmatik ekranda hedef zorlaşıyor; burada her masa aynı
// büyük kart, ekran genişliğine göre sütun sayısı değişiyor.
//
// Davranış krokiyle AYNI ve tek yerden geliyor (lib/restoran/use-table-opener.ts):
// açık adisyonu olan masa adisyona götürür, boş masa tek dokunuşta adisyon açar,
// belirsiz durum (toplanacak / rezerve) önce sorar. İki ekranın bu noktada
// ayrışmaması şart — garson hangisini kullandığına göre farklı sonuç almamalı.
//
// Masasız (paket/gel-al) adisyon da buradan açılabilir: kasadaki kişi paket
// siparişi için Adisyonlar ekranına geçmek zorunda kalmasın. Diyalog Adisyonlar
// ekranıyla ORTAK (NewTicketDialog) — masa seçimi orada da opsiyonel.

import { useEffect, useMemo, useState } from "react"
import { CircleDot, Clock, Loader2, ShoppingBag, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { CompanyLink } from "@/components/dashboard/company-link"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { NewTicketDialog } from "@/components/restoran/new-ticket-dialog"
import { TableActionDialog } from "@/components/restoran/table-action-dialog"
import { elapsedLabel } from "@/components/restoran/floor-plan-canvas"
import { useTableOpener, tableTapIntent } from "@/lib/restoran/use-table-opener"
import { useTables, type PlanTable } from "@/lib/swr/use-restoran"
import { currency } from "@/lib/fis/receipt-html"
import { cn } from "@/lib/utils"

const ALL_AREAS = "__ALL__"

export function TableListScreen() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { tables, isLoading, error, mutate } = useTables(companyId)
  const { busyTableId, openTicketFor, goToTicket, markCleaned, markNoShow } = useTableOpener(
    companyId,
    mutate,
  )

  const [search, setSearch] = useState("")
  const [activeArea, setActiveArea] = useState<string>(ALL_AREAS)
  const [pending, setPending] = useState<PlanTable | null>(null)
  const [newTicketOpen, setNewTicketOpen] = useState(false)

  /**
   * Süre etiketleri dakikada bir tazelenir. Saniyede bir yeniden çizmek listeyi
   * boşuna canlandırırdı; gösterilen birim zaten dakika.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const activeTables = useMemo(() => tables.filter((t) => t.isActive), [tables])

  const areas = useMemo(() => {
    const set = new Set<string>()
    for (const t of activeTables) if (t.areaName) set.add(t.areaName)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr-TR"))
  }, [activeTables])

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    return activeTables
      .filter((t) => activeArea === ALL_AREAS || t.areaName === activeArea)
      .filter((t) => !q || t.name.toLocaleLowerCase("tr-TR").includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "tr-TR", { numeric: true }))
  }, [activeTables, activeArea, search])

  const openCount = activeTables.filter((t) => t.openTicket).length

  function tapTable(table: PlanTable) {
    const intent = tableTapIntent(table)
    if (intent === "ticket") {
      goToTicket(table.openTicket!.id)
      return
    }
    if (intent === "ask") {
      setPending(table)
      return
    }
    void openTicketFor(table)
  }

  const areaTab = (isActive: boolean) =>
    cn(
      "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
      isActive
        ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/70",
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Masa Listesi</h1>
          <p className="text-sm text-muted-foreground">
            Masaya dokun, adisyon açılsın. Açık masa doğrudan hesabına gider.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {activeTables.length} masa · <span className="font-semibold">{openCount}</span> açık
          </p>
          {/* Paket/gel-al siparişinin masası yoktur; bu ekranda tek başına
              ulaşılabilir olmalı, yoksa kasadaki kişi Adisyonlar'a geçiyor. */}
          <Button size="lg" onClick={() => setNewTicketOpen(true)} disabled={!companyId}>
            <ShoppingBag className="mr-2 h-4 w-4" />
            Masasız adisyon
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3">
          {(areas.length > 1 || activeTables.length > 12) && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {areas.length > 1 ? (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setActiveArea(ALL_AREAS)}
                    className={areaTab(activeArea === ALL_AREAS)}
                  >
                    Tümü
                  </button>
                  {areas.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setActiveArea(a)}
                      className={areaTab(activeArea === a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              ) : (
                <span />
              )}
              {activeTables.length > 12 && (
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Masa ara…"
                  className="h-10 w-full sm:w-48"
                />
              )}
            </div>
          )}

          {/* Yükleme ve hata boş listeden AYRI: masa listesi çekilemediğinde
              "masa yok" demek garsonu yanıltır — salon dolu, ekran boş. */}
          {error ? (
            <div className="py-12 text-center text-sm text-red-600 dark:text-red-400">
              <FetchErrorText error={error} subject="Masalar" />
            </div>
          ) : isLoading && tables.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Masalar yükleniyor…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {activeTables.length === 0 ? (
                <>
                  Tanımlı masa yok.{" "}
                  <CompanyLink
                    href="/restoran/masalar"
                    className="font-semibold text-kobipo-blue underline-offset-4 hover:underline dark:text-primary"
                  >
                    Masalar
                  </CompanyLink>{" "}
                  ekranından salon planınızı kurun.
                </>
              ) : (
                "Bu aramaya/bölgeye uyan masa yok"
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {visible.map((table) => {
                const ticket = table.openTicket
                const busy = busyTableId === table.id
                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={busy}
                    onClick={() => tapTable(table)}
                    className={cn(
                      // min-h: dokunmatikte hedef bol olsun; kroki kutularının
                      // ölçeğe göre küçülme sorunu bu ekranda hiç doğmasın.
                      "relative flex min-h-[104px] flex-col justify-between gap-1 rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-60",
                      ticket
                        ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                        : table.reservation
                          ? "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10"
                          : table.cleaningSince
                            ? "border-dashed border-muted-foreground/40 bg-muted/40"
                            : "border-border hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10",
                    )}
                  >
                    <span className="flex items-start justify-between gap-1">
                      <span className="text-lg font-bold leading-tight">{table.name}</span>
                      {busy ? (
                        <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : ticket ? (
                        <CircleDot className="mt-1 h-4 w-4 shrink-0 text-kobipo-blue dark:text-primary" />
                      ) : null}
                    </span>

                    {/* Durum satırı: masa BOŞSA hiçbir şey yazılmaz — ekranın
                        tamamı "sadece masa adı" olsun diye. */}
                    {ticket ? (
                      <span className="flex flex-col gap-0.5 text-xs">
                        <span className="font-semibold text-kobipo-blue tabular-nums dark:text-primary">
                          {currency(ticket.total)}
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" />
                          {elapsedLabel(ticket.openedAt, now)}
                          {ticket.guestCount ? (
                            <>
                              <Users className="ml-1 h-3 w-3 shrink-0" />
                              {ticket.guestCount}
                            </>
                          ) : null}
                        </span>
                      </span>
                    ) : table.reservation ? (
                      <span className="truncate text-xs font-medium text-amber-700 dark:text-amber-400">
                        {new Date(table.reservation.reservedAt).toLocaleTimeString("tr-TR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        rezerve
                      </span>
                    ) : table.cleaningSince ? (
                      <span className="text-xs text-muted-foreground">Toplanacak</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Boş</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {companyId && (
        <NewTicketDialog
          open={newTicketOpen}
          onOpenChange={setNewTicketOpen}
          companyId={companyId}
          tables={tables}
          onCreated={() => void mutate()}
        />
      )}

      <TableActionDialog
        table={pending}
        now={now}
        onClose={() => setPending(null)}
        onOpenTicket={(t, reservationId) => void openTicketFor(t, reservationId)}
        onMarkCleaned={(t) => void markCleaned(t)}
        onMarkNoShow={(t) => void markNoShow(t)}
      />
    </div>
  )
}
