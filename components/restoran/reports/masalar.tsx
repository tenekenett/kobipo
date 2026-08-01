"use client"

// Masa & adisyon raporu — Aşama 2 Faz D (docs/restoran/ASAMA2.md).
//
// Diğer raporlar ÜRÜNE bakar (ne satıldı, ne kazandırdı); bu rapor MASAYA bakar:
// hesap ne kadar sürdü, masa kaç kez döndü, salon hangi saatte doluyor. Restoranda
// kapasite kararları (masa ekle/çıkar, vardiya, rezervasyon) bu sayılarla verilir.

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
  duration,
  money,
  pct,
  useReport,
  type ReportProps,
} from "@/components/restoran/report-ui"

type Bucket = {
  key: string
  name: string
  areaName: string | null
  tickets: number
  revenue: number
  avgTicket: number
  avgMinutes: number | null
  /** Masa boşaldıktan sonra sıradaki müşteriye kadar geçen ortalama ölü zaman. */
  avgIdleMinutes: number | null
  idleMinutes: number
  idleGaps: number
  guests: number
}

type Data = {
  summary: {
    tickets: number
    revenue: number
    revenueNet: number
    avgTicket: number
    avgMinutes: number | null
    guests: number
    avgGuests: number | null
    revenuePerGuest: number | null
    guestTickets: number
    tablesUsed: number
    activeTables: number
    turnover: number | null
    avgIdleMinutes: number | null
    idleMinutes: number
    idleGaps: number
    /** Servis arası sayılıp ortalamaya girmeyen uzun boşluk sayısı. */
    idleSkipped: number
    idleMaxMinutes: number
  }
  tables: Bucket[]
  areas: Bucket[]
  hours: { hour: number; tickets: number; revenue: number }[]
}

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`

export function MasalarReport({ range }: ReportProps) {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { data, error, isLoading } = useReport<Data>(
    "/api/restoran/raporlar/masalar",
    companyId,
    range.query
  )

  const s = data?.summary
  const tables = data?.tables ?? []
  const areas = data?.areas ?? []
  const hours = data?.hours ?? []
  const maxHour = Math.max(0, ...hours.map((h) => h.revenue))
  const maxTable = Math.max(0, ...tables.map((t) => t.revenue))

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Kapanan adisyonlara göre masa süresi, ortalama sepet ve doluluk. Ciro KDV dahil,
        fişin kesin tutarından alınır.{" "}
        <strong>Boş bekleme</strong>, aynı masada bir müşteri kalktıktan sonra sıradakinin
        oturmasına kadar geçen ölü zamandır — aynı gün içinde ve en çok{" "}
        {s?.idleMaxMinutes ?? 120} dakikalık boşluklar sayılır, daha uzunları servis arası
        kabul edilir
        {(s?.idleSkipped ?? 0) > 0 ? ` (${s?.idleSkipped} boşluk bu yüzden hariç)` : ""}.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Kapanan adisyon"
          value={String(s?.tickets ?? 0)}
          hint={`${s?.tablesUsed ?? 0} / ${s?.activeTables ?? 0} masa kullanıldı`}
          tone="brand"
        />
        <StatTile
          label="Ortalama sepet"
          value={money(s?.avgTicket ?? 0)}
          hint={`toplam ${money(s?.revenue ?? 0)}`}
        />
        <StatTile
          label="Ortalama masa süresi"
          value={duration(s?.avgMinutes)}
          hint="açılıştan hesap kapanışına"
        />
        <StatTile
          label="Masa devir hızı"
          value={s?.turnover != null ? s.turnover.toFixed(1) : "—"}
          hint="masa başına adisyon (aralık boyunca)"
        />
        <StatTile
          label="Ortalama boş bekleme"
          value={duration(s?.avgIdleMinutes)}
          hint={
            (s?.idleGaps ?? 0) > 0
              ? `${s?.idleGaps} devirde toplam ${duration(s?.idleMinutes)} ölü zaman`
              : "aynı masaya arka arkaya oturulmamış"
          }
        />
        <StatTile
          label="Kişi başı ortalama"
          value={s?.revenuePerGuest != null ? money(s.revenuePerGuest) : "—"}
          hint={
            (s?.guestTickets ?? 0) > 0
              ? `${s?.guests} kişi · ${s?.guestTickets} adisyonda girildi`
              : "kişi sayısı girilmemiş"
          }
        />
        <StatTile
          label="Ortalama kişi/masa"
          value={s?.avgGuests != null ? s.avgGuests.toFixed(1) : "—"}
          hint="kişi sayısı girilen adisyonlar"
        />
      </div>

      <ReportState
        isLoading={isLoading && !data}
        error={error}
        empty={tables.length === 0}
        emptyText="Bu aralıkta kapanmış adisyon yok."
      />

      {hours.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Saat bazında yoğunluk</CardTitle>
            <CardDescription>
              Adisyonun AÇILDIĞI saate göre — vardiya planlaması için
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {hours.map((h) => (
                <div key={h.hour} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {hourLabel(h.hour)}
                  </span>
                  <div className="flex-1">
                    <Bar pct={maxHour > 0 ? (h.revenue / maxHour) * 100 : 0} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {h.tickets} adisyon
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums">
                    {money(h.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {areas.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Bölge karşılaştırması</CardTitle>
            <CardDescription>Bahçe mi salon mu daha çok kazandırıyor</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {areas.map((a) => (
                <div key={a.key} className="rounded-lg border p-3">
                  <p className="truncate font-semibold">{a.name}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">{money(a.revenue)}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.tickets} adisyon · ortalama {money(a.avgTicket)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ortalama süre {duration(a.avgMinutes)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ortalama boş bekleme {duration(a.avgIdleMinutes)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tables.length > 0 && (
        <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                <StyledTableHead>Masa</StyledTableHead>
                <StyledTableHead>Bölge</StyledTableHead>
                <StyledTableHead className="text-right">Adisyon</StyledTableHead>
                <StyledTableHead className="text-right">Ort. süre</StyledTableHead>
                <StyledTableHead className="text-right">Ort. boş</StyledTableHead>
                <StyledTableHead className="text-right">Toplam boş</StyledTableHead>
                <StyledTableHead className="text-right">Ort. sepet</StyledTableHead>
                <StyledTableHead className="text-right">Ciro</StyledTableHead>
                <StyledTableHead className="w-32">Pay</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {tables.map((t) => (
                <StyledTableRow key={t.key}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.areaName || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.tickets}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {duration(t.avgMinutes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {duration(t.avgIdleMinutes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {t.idleGaps > 0 ? duration(t.idleMinutes) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(t.avgTicket)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {money(t.revenue)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Bar pct={maxTable > 0 ? (t.revenue / maxTable) * 100 : 0} />
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {pct((s?.revenue ?? 0) > 0 ? (t.revenue / (s?.revenue ?? 1)) * 100 : 0)}
                      </span>
                    </div>
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
