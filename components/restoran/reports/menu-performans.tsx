"use client"

// Menü performansı — bkz. docs/restoran/PLAN.md "Adım 6", ILERLEME.md "Adım 8".
// "En çok satan" ile "en çok kazandıran" ayrı sorulardır; sıralama bu yüzden
// değiştirilebilir.

import { useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
} from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { ProductLink } from "@/components/raporlar/rapor-link"
import {
  Bar,
  ReportState,
  StatTile,
  marginTone,
  money,
  pct,
  qty,
  useReport,
  type ReportProps,
} from "@/components/restoran/report-ui"
import { cn } from "@/lib/utils"

type Item = {
  productId: string | null
  name: string
  unit: string | null
  category: string | null
  quantity: number
  revenue: number
  cost: number
  profit: number
  margin: number | null
  costBasis: "recipe" | "purchase" | "none"
  pricelessCount: number
}

type Data = {
  items: Item[]
  totals: {
    quantity: number
    revenue: number
    cost: number
    profit: number
    margin: number | null
    frozenRecipeCost: number
  }
}

const SORTS = [
  { key: "revenue", label: "Ciro" },
  { key: "quantity", label: "Adet" },
  { key: "profit", label: "Kâr" },
  { key: "margin", label: "Marj" },
] as const

type SortKey = (typeof SORTS)[number]["key"]

export function MenuPerformansReport({ range }: ReportProps) {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const [sort, setSort] = useState<SortKey>("revenue")
  const { data, error, isLoading } = useReport<Data>(
    "/api/restoran/raporlar/menu-performans",
    companyId,
    range.query
  )

  const items = useMemo(() => {
    const list = [...(data?.items ?? [])]
    list.sort((a, b) => {
      if (sort === "margin") {
        // Marjı olmayan (cirosuz) satır en sona.
        if (a.margin == null) return 1
        if (b.margin == null) return -1
        return b.margin - a.margin
      }
      return b[sort] - a[sort]
    })
    return list
  }, [data, sort])

  const totals = data?.totals
  const maxRevenue = Math.max(0, ...items.map((i) => i.revenue))
  // Hesaplanan maliyet ile gerçekleşen (dondurulmuş) toplam sapıyorsa aralıkta
  // reçete değişmiş demektir — sessiz kalmak yerine göster.
  const drift =
    totals && totals.frozenRecipeCost > 0
      ? Math.abs(totals.cost - totals.frozenRecipeCost) / totals.frozenRecipeCost
      : 0

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
          Ürün bazında satış adedi, ciro, maliyet ve kâr. Çok satan ürün her zaman çok kazandıran
          ürün değildir.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Ciro (KDV hariç)" value={money(totals?.revenue ?? 0)} tone="brand" />
        <StatTile label="Satılan adet" value={qty(totals?.quantity ?? 0)} />
        <StatTile label="Maliyet" value={money(totals?.cost ?? 0)} />
        <StatTile
          label="Kâr / Marj"
          value={money(totals?.profit ?? 0)}
          hint={pct(totals?.margin)}
          tone={marginTone(totals?.margin ?? null)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sırala
        </span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSort(s.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              sort === s.key
                ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <ReportState
        isLoading={isLoading && !data}
        error={error}
        empty={items.length === 0}
        emptyText="Bu aralıkta satış yok."
      />

      {items.length > 0 && (
        <>
          <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>Ürün</StyledTableHead>
                  <StyledTableHead className="text-right">Adet</StyledTableHead>
                  <StyledTableHead className="text-right">Ciro</StyledTableHead>
                  <StyledTableHead className="text-right">Maliyet</StyledTableHead>
                  <StyledTableHead className="text-right">Kâr</StyledTableHead>
                  <StyledTableHead className="text-right">Marj</StyledTableHead>
                  <StyledTableHead className="w-32">Ciro payı</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <StyledTableRow key={`${i.productId ?? "x"}-${i.name}`}>
                    <TableCell>
                      <div className="font-semibold">
                        <ProductLink companyId={companyId} productRef={i.productId}>
                          {i.name}
                        </ProductLink>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {i.category || "kategorisiz"}
                        {i.costBasis === "purchase" && " · maliyet alış fiyatından"}
                        {i.costBasis === "none" && " · maliyet bilinmiyor"}
                        {i.pricelessCount > 0 && " · bazı bileşenlerde alış fiyatı yok"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qty(i.quantity)}
                      {i.unit ? <span className="ml-1 text-xs text-muted-foreground">{i.unit}</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {money(i.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {i.costBasis === "none" && i.cost === 0 ? "—" : money(i.cost)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        i.profit < 0 ? "text-red-600 dark:text-red-400" : ""
                      )}
                    >
                      {money(i.profit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={cn(
                          i.margin == null
                            ? "text-muted-foreground"
                            : i.margin < 0
                              ? "text-red-600 dark:text-red-400"
                              : i.margin < 20
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        {pct(i.margin)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Bar pct={maxRevenue > 0 ? (i.revenue / maxRevenue) * 100 : 0} />
                    </TableCell>
                  </StyledTableRow>
                ))}
              </TableBody>
            </Table>
          </StyledTableContainer>

          <Card>
            <CardContent className="space-y-1 p-4 text-xs text-muted-foreground">
              <p>
                Maliyet, ürünün <strong>güncel reçetesiyle</strong> açılıp bileşenlerin aralıkta
                gerçekleşen ortalama birim maliyetiyle çarpılarak bulunur. Reçetesiz ürünlerde
                ürün kartındaki alış fiyatı kullanılır.
              </p>
              {drift > 0.01 && (
                <p className="text-amber-600 dark:text-amber-400">
                  Hesaplanan hammadde maliyeti ({money(totals?.cost ?? 0)}) ile fiilen düşen
                  dondurulmuş maliyet ({money(totals?.frozenRecipeCost ?? 0)}) arasında{" "}
                  {pct(drift * 100)} fark var — bu aralıkta reçete değişmiş olabilir. Toplam kâr
                  için Karlılık raporu esastır.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
