"use client"

// Hammadde tüketimi — bkz. docs/restoran/PLAN.md "Adım 6", ILERLEME.md "Adım 8".
// Kaynak: reçeteden türeyen stok hareketleri. Satın alma planlaması için
// "kaç günlük stok kaldı" sütunu da hesaplanır.

import { Card, CardContent } from "@/components/ui/card"
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
  RangeBar,
  ReportState,
  StatTile,
  money,
  pct,
  qty,
  useReport,
  useReportRange,
} from "@/components/restoran/report-ui"
import { cn } from "@/lib/utils"

type Item = {
  productId: string | null
  name: string
  unit: string
  quantity: number
  cost: number
  unitCost: number
  stock: number
  minStock: number | null
  avgPerDay: number
  daysLeft: number | null
  share: number
}

type Data = {
  range: { days: number }
  items: Item[]
  totals: { cost: number; count: number }
}

/** Kaç günlük stok kaldığı — kritik eşik satın alma sıklığına göre kabaca 3/7 gün. */
const daysTone = (d: number | null) =>
  d == null ? "" : d < 3 ? "text-red-600 dark:text-red-400" : d < 7 ? "text-amber-600 dark:text-amber-400" : ""

export default function RestoranTuketimPage() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const range = useReportRange("week")
  const { data, error, isLoading } = useReport<Data>(
    "/api/restoran/raporlar/tuketim",
    companyId,
    range.query
  )

  const items = data?.items ?? []
  const days = data?.range?.days ?? 1
  const critical = items.filter((i) => i.daysLeft != null && i.daysLeft < 7)

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
        <h1 className="text-3xl font-bold">Hammadde Tüketimi</h1>
        <p className="text-muted-foreground">
          Aralıkta hangi bileşenden ne kadar gitti. Yalnızca reçeteden türeyen hareketler sayılır;
          doğrudan satılan ürünler bu listeye girmez.
        </p>
      </div>

      <RangeBar range={range} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Toplam tüketim"
          value={money(data?.totals.cost ?? 0)}
          hint={`${days} günlük aralık`}
          tone="brand"
        />
        <StatTile label="Hammadde çeşidi" value={String(data?.totals.count ?? 0)} />
        <StatTile
          label="Yakında bitecek"
          value={String(critical.length)}
          hint="7 günden az stok kalanlar"
          tone={critical.length > 0 ? "warn" : "default"}
        />
      </div>

      <ReportState
        isLoading={isLoading && !data}
        error={error}
        empty={items.length === 0}
        emptyText="Bu aralıkta reçeteli satış yok — tüketim oluşmamış."
      />

      {items.length > 0 && (
        <>
          <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>Hammadde</StyledTableHead>
                  <StyledTableHead className="text-right">Tüketim</StyledTableHead>
                  <StyledTableHead className="text-right">Birim maliyet</StyledTableHead>
                  <StyledTableHead className="text-right">Tutar</StyledTableHead>
                  <StyledTableHead className="w-28">Pay</StyledTableHead>
                  <StyledTableHead className="text-right">Günlük ort.</StyledTableHead>
                  <StyledTableHead className="text-right">Kalan stok</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <StyledTableRow key={i.productId ?? i.name}>
                    <TableCell>
                      <div className="font-semibold">{i.name}</div>
                      {i.minStock != null && (
                        <div className="text-xs text-muted-foreground">
                          Kritik eşik {qty(i.minStock)} {i.unit}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {qty(i.quantity)} <span className="text-xs text-muted-foreground">{i.unit}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {i.unitCost > 0 ? `${money(i.unitCost)}/${i.unit}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {money(i.cost)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Bar pct={i.share} />
                        <span className="text-[11px] text-muted-foreground">{pct(i.share)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {qty(i.avgPerDay)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div
                        className={cn(
                          "font-medium",
                          i.minStock != null && i.stock <= i.minStock
                            ? "text-amber-600 dark:text-amber-400"
                            : ""
                        )}
                      >
                        {qty(i.stock)} {i.unit}
                      </div>
                      {i.daysLeft != null && (
                        <div className={cn("text-xs", daysTone(i.daysLeft))}>
                          ~{i.daysLeft < 1 ? "1 günden az" : `${Math.floor(i.daysLeft)} gün`}
                        </div>
                      )}
                    </TableCell>
                  </StyledTableRow>
                ))}
              </TableBody>
            </Table>
          </StyledTableContainer>

          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground">
              &quot;Kalan stok&quot; anlık bakiyedir; &quot;~gün&quot; ise bu aralıktaki günlük
              ortalama tüketim bu hızda sürerse stoğun kaç gün yeteceğidir. Yarı mamüller (kendi
              reçetesi olan ürünler) sanal olduğu için listede görünmez — tüketim hammaddeye
              inmiş haliyle sayılır.
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
