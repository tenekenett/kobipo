"use client"

// Karlılık raporu — bkz. docs/restoran/PLAN.md "Adım 6", ILERLEME.md "Adım 8".
// Maliyet satış anında donduruldu (StockMovement.unitPrice); bu ekran onu okur,
// yeniden hesaplamaz — sonradan gelen zam geçmiş günleri değiştirmez.

import { CompanyLink } from "@/components/dashboard/company-link"
import { AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

type Data = {
  totals: {
    revenue: number
    revenueGross: number
    receipts: number
    avgTicket: number
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
