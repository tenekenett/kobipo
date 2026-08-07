"use client"

// Karlılık raporu — bkz. docs/restoran/PLAN.md "Adım 6", ILERLEME.md "Adım 8".
// Maliyet satış anında donduruldu (StockMovement.unitPrice); bu ekran onu okur,
// yeniden hesaplamaz — sonradan gelen zam geçmiş günleri değiştirmez.

import { useState } from "react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  marginTone,
  money,
  money0,
  pct,
  useReport,
  type ReportProps,
} from "@/components/restoran/report-ui"
import { PAYMENT_METHOD_LABELS } from "@/lib/satis/payment"
import { cn } from "@/lib/utils"

/** Tahsil edilmemiş dilimin sahte yöntem kodu — gerçek bir ödeme tipi değil. */
const UNPAID = "__UNPAID__"

/**
 * Belgenin detay sayfası.
 *
 * Fiş ile fatura AYRI sayfalara gider: fişi `/faturalar/.../onizleme`de açmak onu
 * "Satış Faturası" başlığıyla gösteriyordu — restoran fişi fatura değildir.
 *
 * `from` ile geri dönüş yolu taşınıyor; iki sayfanın "Geri" düğmesi de aksi halde
 * kendi listesine (Satış Faturaları / Satış Fişleri) gider, rapora değil.
 * ENCODE ŞART: `from` değerinin kendi `?rapor=` parametresi var, kodlanmazsa
 * hedef sayfa onu ayrı bir param sanar ve geri dönüş sekmesi kaybolur.
 */
const belgeHref = (d: Doc) => {
  const from = encodeURIComponent("/restoran/raporlar?rapor=karlilik")
  return d.isReceipt
    ? `/fisler/${d.id}?from=${from}`
    : `/faturalar/${d.id}/onizleme?from=${from}`
}

/** Belge listesindeki tarih — aralık birden çok güne yayılabildiği için gün + saat. */
const gunSaat = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

/** Ödeme yöntemi etiketi — fatura tarafında CHECK ve OTHER da geçebiliyor. */
const methodLabel = (m: string) =>
  (PAYMENT_METHOD_LABELS as Record<string, string>)[m] ??
  ({ CHECK: "Çek/Senet", OTHER: "Diğer" } as Record<string, string>)[m] ??
  m

type Day = {
  day: string
  receipts: number
  revenue: number
  revenueGross: number
  recipeCost: number
  directCost: number
  cost: number
  profit: number
  margin: number | null
}

type Payment = { method: string; count: number; amount: number }

/** Dilimi oluşturan belge — tıklayınca açılan listede gösterilir. */
type Doc = {
  id: string
  invoiceNo: string
  date: string
  isReceipt: boolean
  customerName: string | null
  total: number
  paid: number
  unpaid: number
  methods: Record<string, number>
}

type Data = {
  payments: Payment[]
  documents: Doc[]
  totals: {
    revenue: number
    revenueGross: number
    receipts: number
    avgTicket: number
    paidTotal: number
    unpaid: number
    recipeCost: number
    directCost: number
    cost: number
    grossProfit: number
    margin: number | null
    /** Maliyeti hiç bilinmeyen ürün sayısı — bunlar 0 maliyetle toplandı. */
    pricelessCount: number
  }
  days: Day[]
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    weekday: "short",
  })

export function KarlilikReport({ range }: ReportProps) {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { data, error, isLoading } = useReport<Data>(
    "/api/restoran/raporlar/karlilik",
    companyId,
    range.query
  )

  const totals = data?.totals
  const days = data?.days ?? []
  const maxRevenue = Math.max(0, ...days.map((d) => d.revenue))

  /**
   * Gelirin ödeme tipine göre dağılımı.
   *
   * NAKİT ve KREDİ KARTI kayıt olmasa da her zaman çizilir: "bu dönemde hiç
   * nakit yok" bilgisi, satırın hiç görünmemesinden farklı bir şeydir — ikincisi
   * "rapor eksik mi" sorusunu doğurur. Diğer tipler (havale, yemek kartı, çek…)
   * yalnız o aralıkta gerçekten varsa listeye girer.
   *
   * Payda ciro KDV DAHİL: tahsilatlar KDV dahil tutarlardır, KDV hariç ciroya
   * oranlansaydı yüzdeler %100'ü aşardı.
   */
  const payments = data?.payments ?? []
  const revenueGross = totals?.revenueGross ?? 0
  const unpaid = totals?.unpaid ?? 0
  const paymentOf = (m: string) => payments.find((p) => p.method === m)
  const digerleri = payments.filter((p) => p.method !== "CASH" && p.method !== "CREDIT_CARD")
  const dilimler = [
    { method: "CASH", count: paymentOf("CASH")?.count ?? 0, amount: paymentOf("CASH")?.amount ?? 0 },
    {
      method: "CREDIT_CARD",
      count: paymentOf("CREDIT_CARD")?.count ?? 0,
      amount: paymentOf("CREDIT_CARD")?.amount ?? 0,
    },
    ...digerleri,
  ]
  const payda = revenueGross > 0 ? revenueGross : 0
  const oran = (tutar: number) => (payda > 0 ? (tutar / payda) * 100 : 0)

  /**
   * Açık dilim — "CASH" gibi bir yöntem kodu ya da tahsil edilmemiş için
   * `UNPAID`. Aynı anda tek dilim açık: yan yana iki liste hangi satırın
   * hangisine ait olduğunu belirsizleştirirdi.
   */
  const [acikDilim, setAcikDilim] = useState<string | null>(null)
  const documents = data?.documents ?? []
  const dilimBelgeleri = (method: string): Array<Doc & { pay: number }> =>
    method === UNPAID
      ? documents.filter((d) => d.unpaid > 0).map((d) => ({ ...d, pay: d.unpaid }))
      : documents
          .filter((d) => (d.methods[method] ?? 0) > 0)
          .map((d) => ({ ...d, pay: d.methods[method] }))

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          Ciro, hammadde maliyeti ve brüt kâr. Maliyet satış anında dondurulur; sonradan gelen
          zamlar geçmiş günlerin kârını değiştirmez.
        </p>
      </div>

      {/* Maliyeti bilinmeyen ürünler 0 sayıldı → gösterilen kâr GERÇEKTEN OLANDAN
          YÜKSEK. Sessiz bırakılırsa kullanıcı %100 marjı gerçek sanar. */}
      {(totals?.pricelessCount ?? 0) > 0 && (
        <Card className="border-amber-300 dark:border-amber-700/60">
          <CardContent className="flex items-start gap-2 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              <strong>{totals?.pricelessCount}</strong> üründe maliyet bilgisi yok (ne alış
              hareketi ne de alış fiyatı). Bu ürünler <strong>sıfır maliyetle</strong> hesaba
              girdi — gerçek kâr burada görünenden düşük. Alış fiyatlarını{" "}
              <CompanyLink
                href="/restoran/menu"
                className="font-semibold text-kobipo-blue underline-offset-4 hover:underline dark:text-primary"
              >
                Menü &amp; Reçeteler
              </CompanyLink>{" "}
              ekranından tamamlayabilirsiniz.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Ciro (KDV hariç)"
          value={money(totals?.revenue ?? 0)}
          hint={`KDV dahil ${money(totals?.revenueGross ?? 0)}`}
          tone="brand"
        />
        <StatTile
          label="Fiş adedi"
          value={String(totals?.receipts ?? 0)}
          hint={`Ortalama fiş ${money(totals?.avgTicket ?? 0)} (KDV dahil)`}
        />
        <StatTile
          label="Hammadde maliyeti"
          value={money(totals?.recipeCost ?? 0)}
          hint={
            (totals?.directCost ?? 0) > 0
              ? `+ reçetesiz ürün ${money(totals?.directCost ?? 0)}`
              : "reçete hareketlerinden"
          }
        />
        <StatTile label="Toplam maliyet" value={money(totals?.cost ?? 0)} />
        <StatTile
          label="Brüt kâr"
          value={money(totals?.grossProfit ?? 0)}
          tone={(totals?.grossProfit ?? 0) < 0 ? "bad" : "good"}
        />
        <StatTile label="Marj" value={pct(totals?.margin)} tone={marginTone(totals?.margin ?? null)} />
      </div>

      {(totals?.directCost ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Reçetesiz satılan ürünlerin maliyeti ürün kartındaki <strong>alış fiyatından</strong>{" "}
          hesaplanır (satış anında dondurulmaz); reçeteli ürünlerin maliyeti gerçekleşen
          hareketlerden gelir.
        </p>
      )}

      {days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Gelir dağılımı — ödeme tipi</CardTitle>
            <CardDescription>
              Bu aralıkta kesilen belgelerin ödemeleri. Yüzdeler KDV DAHİL ciroya (
              {money(revenueGross)}) göre. Gün Sonu raporundaki dağılım farklı bir soruyu
              cevaplar: orası <strong>tahsilat tarihine</strong> bakar (o gün kasaya ne girdi),
              burası <strong>belge tarihine</strong> (bu ciro neyle ödendi).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                ...dilimler.map((p) => ({
                  method: p.method,
                  label: methodLabel(p.method),
                  hint: p.count > 0 ? `${p.count} belge` : null,
                  amount: p.amount,
                  tone: (p.method === "CASH" ? "green" : "brand") as "green" | "brand" | "amber",
                  vurgu: false,
                })),
                ...(unpaid > 0
                  ? [
                      {
                        method: UNPAID,
                        label: "Tahsil edilmemiş",
                        hint: "veresiye / açık hesap",
                        amount: unpaid,
                        tone: "amber" as const,
                        vurgu: true,
                      },
                    ]
                  : []),
              ].map((p) => {
                const acik = acikDilim === p.method
                // Tutarı sıfır olan dilim açılmaz: altında listelenecek belge yok.
                const acilabilir = p.amount > 0
                const belgeler = acik ? dilimBelgeleri(p.method) : []
                return (
                  <div key={p.method} className="space-y-1">
                    <button
                      type="button"
                      disabled={!acilabilir}
                      onClick={() => setAcikDilim(acik ? null : p.method)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left text-xs transition-colors",
                        acilabilir ? "hover:bg-muted" : "cursor-default",
                      )}
                    >
                      <span
                        className={cn(
                          "flex items-center gap-1 font-medium",
                          p.vurgu && "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {acilabilir ? (
                          acik ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          )
                        ) : (
                          <span className="w-3.5" />
                        )}
                        {p.label}
                        {p.hint && <span className="ml-1 text-muted-foreground">{p.hint}</span>}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-semibold tabular-nums",
                          p.vurgu && "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {money(p.amount)}
                        <span className="ml-2 text-muted-foreground">{pct(oran(p.amount))}</span>
                      </span>
                    </button>
                    <Bar pct={oran(p.amount)} tone={p.tone} />

                    {acik && (
                      <div className="pt-1">
                        {belgeler.length === 0 ? (
                          <p className="py-3 text-center text-xs text-muted-foreground">
                            Bu dilimde belge yok.
                          </p>
                        ) : (
                          <StyledTableContainer>
                            <Table>
                              <TableHeader>
                                <StyledTableHeaderRow>
                                  <StyledTableHead>Tarih</StyledTableHead>
                                  <StyledTableHead>Belge</StyledTableHead>
                                  <StyledTableHead>Müşteri</StyledTableHead>
                                  <StyledTableHead className="text-right">
                                    Belge toplamı
                                  </StyledTableHead>
                                  <StyledTableHead className="text-right">
                                    {p.method === UNPAID ? "Kalan" : "Bu yöntemle"}
                                  </StyledTableHead>
                                </StyledTableHeaderRow>
                              </TableHeader>
                              <TableBody>
                                {belgeler.map((d) => (
                                  <StyledTableRow key={d.id}>
                                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                                      {gunSaat(d.date)}
                                    </TableCell>
                                    <TableCell>
                                      <CompanyLink
                                        href={`/faturalar/${d.id}/onizleme`}
                                        className="text-xs font-medium underline-offset-4 hover:underline"
                                      >
                                        {d.invoiceNo}
                                      </CompanyLink>
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {d.customerName || "Perakende"}
                                    </TableCell>
                                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                                      {money(d.total)}
                                    </TableCell>
                                    <TableCell
                                      className={cn(
                                        "text-right text-xs font-semibold tabular-nums",
                                        p.vurgu && "text-amber-600 dark:text-amber-400",
                                      )}
                                    >
                                      {money(d.pay)}
                                    </TableCell>
                                  </StyledTableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </StyledTableContainer>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="flex items-center justify-between border-t pt-2 text-sm">
                <span className="font-semibold">Toplam</span>
                <span className="font-bold tabular-nums">
                  {money((totals?.paidTotal ?? 0) + unpaid)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <ReportState
        isLoading={isLoading && !data}
        error={error}
        empty={days.length === 0}
        emptyText="Bu aralıkta satış yok."
      />

      {days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Günlük kırılım</CardTitle>
            <CardDescription>Çubuk = günün cirosu; yanında maliyet, kâr ve marj</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {days.map((d) => (
                <div key={d.day} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
                    <span className="font-medium">
                      {dayLabel(d.day)}
                      <span className="ml-2 text-muted-foreground">{d.receipts} fiş</span>
                    </span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{money0(d.revenue)}</span>
                      <span className="ml-2 text-muted-foreground">−{money0(d.cost)}</span>
                      <span
                        className={
                          d.profit < 0
                            ? "ml-2 font-semibold text-red-600 dark:text-red-400"
                            : "ml-2 font-semibold text-kobipo-green"
                        }
                      >
                        {money0(d.profit)}
                      </span>
                      <span className="ml-2 text-muted-foreground">{pct(d.margin)}</span>
                    </span>
                  </div>
                  <Bar pct={maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
