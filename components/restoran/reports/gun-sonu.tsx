"use client"

// Gün sonu — bkz. docs/restoran/PLAN.md "Adım 6", ILERLEME.md "Adım 8".
//
// İki tarih ekseni ayrı: fişler BELGE tarihine, ödeme dağılımı TAHSİLAT tarihine
// göre gelir (dünkü veresiyenin bugünkü tahsilatı bugünün kasasına girer).

import Link from "next/link"
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import {
  Bar,
  ReportState,
  StatTile,
  duration,
  marginTone,
  money,
  pct,
  useReport,
  type ReportProps,
} from "@/components/restoran/report-ui"
import { PAYMENT_METHOD_LABELS } from "@/lib/satis/payment"

type Receipt = {
  id: string
  invoiceNo: string
  date: string
  isReceipt: boolean
  customerName: string | null
  net: number
  total: number
  paid: number
  methods: string[]
  cost: number
}

/** Gün kapanırken hâlâ açık olan masa — henüz fişe dönüşmemiş hesap. */
type OpenTicket = {
  id: string
  code: string
  tableName: string | null
  guestCount: number | null
  openedAt: string
  minutes: number
  itemCount: number
  total: number
}

type Data = {
  summary: {
    receipts: number
    revenue: number
    revenueGross: number
    avgTicket: number
    cost: number
    grossProfit: number
    margin: number | null
    paid: number
    unpaid: number
    cashReceived: number
    openTicketCount: number
    openTicketTotal: number
  }
  receipts: Receipt[]
  openTickets: OpenTicket[]
  payments: { method: string; count: number; amount: number }[]
  cashCounts: {
    id: string
    accountName: string
    countDate: string
    expected: number
    actual: number
    difference: number
    isApproved: boolean
    notes: string | null
  }[]
}

/** Ödeme yöntemi etiketi — fiş/fatura tarafında CHECK ve OTHER de kullanılabiliyor. */
const methodLabel = (m: string) =>
  (PAYMENT_METHOD_LABELS as Record<string, string>)[m] ??
  ({ CHECK: "Çek/Senet", OTHER: "Diğer" } as Record<string, string>)[m] ??
  m

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })

/**
 * Belgenin detay sayfası — fiş ile fatura AYRI sayfalara gider. Fişi
 * `/faturalar/.../onizleme`de açmak onu "Satış Faturası" başlığıyla gösteriyordu.
 *
 * `from` ile geri dönüş yolu taşınıyor; iki sayfanın "Geri" düğmesi de aksi halde
 * kendi listesine (Satış Faturaları / Satış Fişleri) gider, rapora değil. Değer
 * kendi `?rapor=` param'ını taşıdığı için ENCODE ŞART.
 */
const belgeHref = (r: Receipt, companyId: string | null | undefined) => {
  const q = `?company=${companyId ?? ""}&from=${encodeURIComponent(
    "/restoran/raporlar?rapor=gun-sonu",
  )}`
  return r.isReceipt ? `/fisler/${r.id}${q}` : `/faturalar/${r.id}/onizleme${q}`
}

export function GunSonuReport({ range }: ReportProps) {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { data, error, isLoading } = useReport<Data>(
    "/api/restoran/raporlar/gun-sonu",
    companyId,
    range.query
  )

  const s = data?.summary
  const payments = data?.payments ?? []
  const receipts = data?.receipts ?? []
  const openTickets = data?.openTickets ?? []
  const maxPayment = Math.max(0, ...payments.map((p) => p.amount))
  const paymentTotal = payments.reduce((a, p) => a + p.amount, 0)

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Günün fişleri, ödeme tipi dağılımı ve kasa sayımıyla karşılaştırma.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => range.shiftDay(-1)} aria-label="Önceki gün">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={range.from}
            onChange={(e) => range.setDay(e.target.value)}
            className="h-9 w-40"
          />
          <Button variant="outline" size="icon" onClick={() => range.shiftDay(1)} aria-label="Sonraki gün">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => range.setPreset("today")}>
            Bugün
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Ciro (KDV dahil)"
          value={money(s?.revenueGross ?? 0)}
          hint={`${s?.receipts ?? 0} fiş · ortalama ${money(s?.avgTicket ?? 0)}`}
          tone="brand"
        />
        <StatTile
          label="Tahsil edilen"
          value={money(s?.paid ?? 0)}
          hint={(s?.unpaid ?? 0) > 0.005 ? `${money(s?.unpaid ?? 0)} açık hesap` : "tamamı tahsil edildi"}
          tone={(s?.unpaid ?? 0) > 0.005 ? "warn" : "good"}
        />
        <StatTile label="Nakit tahsilat" value={money(s?.cashReceived ?? 0)} hint="kasaya giren" />
        {/* Yalnız açık masa varken gösteriliyor: masasız çalışan bir kahvecide
            sürekli "0" yazan bir kutu gürültüden başka bir şey değil. */}
        {(s?.openTicketCount ?? 0) > 0 && (
          <StatTile
            label="Açık masalar"
            value={money(s?.openTicketTotal ?? 0)}
            hint={`${s?.openTicketCount} hesap · ciroya dahil değil`}
            tone="warn"
          />
        )}
        <StatTile label="Hammadde maliyeti" value={money(s?.cost ?? 0)} />
        <StatTile
          label="Brüt kâr"
          value={money(s?.grossProfit ?? 0)}
          hint="ciro KDV hariç üzerinden"
          tone={(s?.grossProfit ?? 0) < 0 ? "bad" : "good"}
        />
        <StatTile label="Marj" value={pct(s?.margin)} tone={marginTone(s?.margin ?? null)} />
      </div>

      <ReportState
        isLoading={isLoading && !data}
        error={error}
        empty={receipts.length === 0 && payments.length === 0 && openTickets.length === 0}
        emptyText="Bu günde satış ya da tahsilat yok."
      />

      {openTickets.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800/60">
          <CardHeader>
            <CardTitle className="text-amber-700 dark:text-amber-400">
              Gün sonunda açık kalan masalar
            </CardTitle>
            <CardDescription>
              Bu hesaplar fişe dönüşmedi: yukarıdaki ciroya girmiyorlar ve malzemeleri
              henüz stoktan düşmedi. Kasa sayımında bu tutarı hesaba katın.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {openTickets.map((t) => (
              <Link
                key={t.id}
                href={`/restoran/adisyon/${t.id}?company=${companyId}`}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {t.tableName || "Paket / Gel-al"}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{t.code}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Açılış {time(t.openedAt)} · {duration(t.minutes)} açık · {t.itemCount} kalem
                    {t.guestCount ? ` · ${t.guestCount} kişi` : ""}
                  </p>
                </div>
                <span className="shrink-0 font-bold tabular-nums">{money(t.total)}</span>
              </Link>
            ))}
            <div className="flex items-center justify-between border-t pt-2 text-sm">
              <span className="font-semibold">Toplam açık hesap</span>
              <span className="font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {money(s?.openTicketTotal ?? 0)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {(payments.length > 0 || (data?.cashCounts.length ?? 0) > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Ödeme dağılımı</CardTitle>
              <CardDescription>Tahsilat tarihine göre — o gün kasaya/bankaya giren</CardDescription>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Bu günde tahsilat kaydı yok.
                </p>
              ) : (
                <div className="space-y-3">
                  {payments.map((p) => (
                    <div key={p.method} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">
                          {methodLabel(p.method)}
                          <span className="ml-2 text-muted-foreground">{p.count} işlem</span>
                        </span>
                        <span className="font-semibold tabular-nums">
                          {money(p.amount)}
                          <span className="ml-2 text-muted-foreground">
                            {pct(paymentTotal > 0 ? (p.amount / paymentTotal) * 100 : 0)}
                          </span>
                        </span>
                      </div>
                      <Bar
                        pct={maxPayment > 0 ? (p.amount / maxPayment) * 100 : 0}
                        tone={p.method === "CASH" ? "green" : "brand"}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t pt-2 text-sm">
                    <span className="font-semibold">Toplam</span>
                    <span className="font-bold tabular-nums">{money(paymentTotal)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kasa sayımı</CardTitle>
              <CardDescription>Nakit tahsilat ile sayılan tutarın karşılaştırması</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Bugünkü nakit tahsilat</span>
                <span className="font-bold tabular-nums text-kobipo-green">
                  {money(s?.cashReceived ?? 0)}
                </span>
              </div>

              {(data?.cashCounts.length ?? 0) === 0 ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Bu güne ait kasa sayımı kaydı yok.</p>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/kasa/devir?company=${companyId}`}>
                      Kasa sayımı gir
                      <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {data!.cashCounts.map((c) => (
                    <div key={c.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{c.accountName}</span>
                        <span className="text-xs text-muted-foreground">{time(c.countDate)}</span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Beklenen</p>
                          <p className="font-semibold tabular-nums">{money(c.expected)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Sayılan</p>
                          <p className="font-semibold tabular-nums">{money(c.actual)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Fark</p>
                          <p
                            className={
                              Math.abs(c.difference) < 0.005
                                ? "font-semibold tabular-nums text-kobipo-green"
                                : "font-semibold tabular-nums text-red-600 dark:text-red-400"
                            }
                          >
                            {money(c.difference)}
                          </p>
                        </div>
                      </div>
                      {c.notes && <p className="mt-1.5 text-xs text-muted-foreground">{c.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {receipts.length > 0 && (
        <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                <StyledTableHead>Saat</StyledTableHead>
                <StyledTableHead>Belge</StyledTableHead>
                <StyledTableHead>Müşteri</StyledTableHead>
                <StyledTableHead>Ödeme</StyledTableHead>
                <StyledTableHead className="text-right">Maliyet</StyledTableHead>
                <StyledTableHead className="text-right">Tutar</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {receipts.map((r) => (
                <StyledTableRow key={r.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{time(r.date)}</TableCell>
                  <TableCell>
                    <Link
                      href={belgeHref(r, companyId)}
                      className="font-medium hover:underline"
                    >
                      {r.invoiceNo}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.isReceipt ? "Fiş" : "Fatura"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{r.customerName || "Perakende"}</TableCell>
                  <TableCell className="text-xs">
                    {r.methods.length > 0 ? (
                      r.methods.map(methodLabel).join(" + ")
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">ödenmedi</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.cost > 0 ? money(r.cost) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {money(r.total)}
                  </TableCell>
                </StyledTableRow>
              ))}
            </TableBody>
          </Table>
        </StyledTableContainer>
      )}
    </div>
  )
}
