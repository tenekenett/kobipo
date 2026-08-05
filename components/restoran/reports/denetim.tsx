"use client"

// Denetim raporu — ikram/zayi, iptaller, personel ve rezervasyon.
// Kararlar: docs/restoran/DENETIM-VE-TEMIZLIK.md (Faz 4).
//
// Diğer raporlar "ne sattık, ne kazandık" diye sorar; bu rapor "ne kaybettik ve
// kim yaptı" diye sorar. Kafede ikram günlük bir olaydır ve ölçülmediği sürece
// kaçaktan ayırt edilemez — ölçülemeyen kaçak, olmayan kaçaktır.

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
  ReportState,
  StatTile,
  money,
  pct,
  qty,
  useReport,
  type ReportProps,
} from "@/components/restoran/report-ui"

type Product = {
  kind: "COMP" | "WASTE"
  productId: string
  name: string
  unit: string
  quantity: number
  cost: number
}

type Reason = {
  status: string
  code: string | null
  label: string
  count: number
  quantity: number
  value: number
}

type Cancel = {
  id: string
  code: string
  closedAt: string | null
  tableName: string | null
  reasonLabel: string | null
  reason: string | null
  itemCount: number
  value: number
}

type Staff = {
  userId: string
  name: string
  opened: number
  closed: number
  revenue: number
  avgTicket: number
  cancelled: number
  compWasteCost: number
  voidItems: number
}

type Data = {
  summary: {
    compCost: number
    wasteCost: number
    voidCount: number
    voidValue: number
    cancelledCount: number
    cancelledValue: number
    mergedCount: number
    reservationTotal: number
    seated: number
    noShow: number
    noShowRate: number | null
  }
  products: Product[]
  reasons: Reason[]
  cancelReasons: { code: string | null; label: string; count: number; value: number }[]
  cancelled: Cancel[]
  merged: Cancel[]
  staff: Staff[]
}

const STATUS_LABEL: Record<string, string> = {
  COMP: "İkram",
  WASTE: "Zayi",
  VOID: "İptal edilen kalem",
}

const dayTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—"

export function DenetimReport({ range }: ReportProps) {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { data, error, isLoading } = useReport<Data>(
    "/api/restoran/raporlar/denetim",
    companyId,
    range.query,
  )

  const s = data?.summary
  const products = data?.products ?? []
  const reasons = data?.reasons ?? []
  const cancelled = data?.cancelled ?? []
  const merged = data?.merged ?? []
  const staff = data?.staff ?? []
  const maxCost = Math.max(0, ...products.map((p) => p.cost))

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const empty =
    !!data &&
    products.length === 0 &&
    reasons.length === 0 &&
    cancelled.length === 0 &&
    merged.length === 0

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        İkram, zayi, iptal ve personel kırılımı. <strong>Maliyet</strong> satış anında
        dondurulmuş alış maliyetidir (AVCO); ciroya girmez, kâra girmez —{" "}
        <strong>karşılıksız harcanan malzemedir</strong>. İptal edilen fişin ikramı da geri
        alınır, bu rapora girmez.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="İkram maliyeti"
          value={money(s?.compCost ?? 0)}
          hint="Müşteriye/personele bedelsiz verilen"
          tone="warn"
        />
        <StatTile
          label="Zayi maliyeti"
          value={money(s?.wasteCost ?? 0)}
          hint="Döküldü / bozuldu / yanlış hazırlandı"
          tone="bad"
        />
        <StatTile
          label="İptal edilen adisyon"
          value={String(s?.cancelledCount ?? 0)}
          hint={`${money(s?.cancelledValue ?? 0)} · birleştirme hariç`}
          tone={(s?.cancelledCount ?? 0) > 0 ? "warn" : "default"}
        />
        <StatTile
          label="İptal edilen kalem"
          value={String(s?.voidCount ?? 0)}
          hint={`${money(s?.voidValue ?? 0)} · hazırlanmadan iptal`}
        />
      </div>

      <ReportState
        isLoading={isLoading}
        error={error}
        empty={empty}
        emptyText="Bu aralıkta ikram, zayi veya iptal kaydı yok."
      />

      {products.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ürün kırılımı</CardTitle>
            <CardDescription>
              Hammadde bazında: reçeteli bir mamül ikram edildiğinde bileşenleri düşer, bu
              yüzden satırlar menü ürününü değil MALZEMEYİ gösterir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Tür</StyledTableHead>
                    <StyledTableHead>Ürün</StyledTableHead>
                    <StyledTableHead className="text-right">Miktar</StyledTableHead>
                    <StyledTableHead className="text-right">Maliyet</StyledTableHead>
                    <StyledTableHead className="w-32">Pay</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <StyledTableRow key={`${p.kind}-${p.productId}`}>
                      <TableCell>
                        <span
                          className={
                            p.kind === "COMP"
                              ? "rounded border border-amber-400 px-1.5 py-px text-[11px] font-bold text-amber-700 dark:text-amber-300"
                              : "rounded border border-red-400 px-1.5 py-px text-[11px] font-bold text-red-700 dark:text-red-300"
                          }
                        >
                          {p.kind === "COMP" ? "İKRAM" : "ZAYİ"}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {qty(p.quantity)} {p.unit}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(p.cost)}
                      </TableCell>
                      <TableCell>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={p.kind === "COMP" ? "h-full bg-amber-500" : "h-full bg-red-500"}
                            style={{ width: `${maxCost > 0 ? (p.cost / maxCost) * 100 : 0}%` }}
                          />
                        </div>
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          </CardContent>
        </Card>
      )}

      {reasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sebepler</CardTitle>
            <CardDescription>
              Adisyon kalemlerinden. Tezgâh (Kahveci Satış) ikramlarının adisyon kaydı
              olmadığı için burada görünmez; tutarları yukarıdaki maliyete dahildir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Tür</StyledTableHead>
                    <StyledTableHead>Sebep</StyledTableHead>
                    <StyledTableHead className="text-right">Kalem</StyledTableHead>
                    <StyledTableHead className="text-right">Adet</StyledTableHead>
                    <StyledTableHead className="text-right">Menü değeri</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {reasons.map((r) => (
                    <StyledTableRow key={`${r.status}-${r.code}`}>
                      <TableCell className="text-muted-foreground">
                        {STATUS_LABEL[r.status] ?? r.status}
                      </TableCell>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{qty(r.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.value)}</TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          </CardContent>
        </Card>
      )}

      {(cancelled.length > 0 || merged.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>İptal edilen adisyonlar</CardTitle>
            <CardDescription>
              Birleştirilen adisyonlar ayrı sayılır: onların cirosu kaybolmadı, hedef hesaba
              geçti{merged.length > 0 ? ` (${merged.length} adisyon)` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Adisyon</StyledTableHead>
                    <StyledTableHead>Masa</StyledTableHead>
                    <StyledTableHead>Zaman</StyledTableHead>
                    <StyledTableHead>Sebep</StyledTableHead>
                    <StyledTableHead className="text-right">Kalem</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {cancelled.map((c) => (
                    <StyledTableRow key={c.id}>
                      <TableCell className="font-medium">{c.code}</TableCell>
                      <TableCell>{c.tableName ?? "Paket / Gel-al"}</TableCell>
                      <TableCell className="text-muted-foreground">{dayTime(c.closedAt)}</TableCell>
                      <TableCell>
                        {c.reasonLabel ?? "Belirtilmemiş"}
                        {c.reason ? (
                          <span className="block text-xs text-muted-foreground">{c.reason}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.itemCount}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(c.value)}
                      </TableCell>
                    </StyledTableRow>
                  ))}
                  {merged.map((m) => (
                    <StyledTableRow key={m.id} className="opacity-60">
                      <TableCell className="font-medium">{m.code}</TableCell>
                      <TableCell>{m.tableName ?? "Paket / Gel-al"}</TableCell>
                      <TableCell className="text-muted-foreground">{dayTime(m.closedAt)}</TableCell>
                      <TableCell className="text-muted-foreground">Birleştirildi</TableCell>
                      <TableCell className="text-right tabular-nums">{m.itemCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        —
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          </CardContent>
        </Card>
      )}

      {staff.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Personel</CardTitle>
            <CardDescription>
              Adisyonu açan/kapatan kullanıcıya göre. İkram ve zayi maliyeti hareketi YAZAN
              kullanıcıya yazılır — adisyonda bu, hesabı kapatan kişidir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Kullanıcı</StyledTableHead>
                    <StyledTableHead className="text-right">Açtı</StyledTableHead>
                    <StyledTableHead className="text-right">Kapattı</StyledTableHead>
                    <StyledTableHead className="text-right">Ciro</StyledTableHead>
                    <StyledTableHead className="text-right">Ort. sepet</StyledTableHead>
                    <StyledTableHead className="text-right">İptal</StyledTableHead>
                    <StyledTableHead className="text-right">İkram/zayi</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {staff.map((u) => (
                    <StyledTableRow key={u.userId}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{u.opened}</TableCell>
                      <TableCell className="text-right tabular-nums">{u.closed}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(u.revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(u.avgTicket)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.cancelled}
                        {u.voidItems > 0 ? (
                          <span className="text-xs text-muted-foreground"> · {u.voidItems} kalem</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(u.compWasteCost)}
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          </CardContent>
        </Card>
      )}

      {(s?.reservationTotal ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rezervasyon</CardTitle>
            <CardDescription>
              Gelmeme oranı yalnız sonuçlanmış rezervasyonlar üzerinden hesaplanır; bekleyenler
              paydaya girmez.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Toplam" value={String(s?.reservationTotal ?? 0)} />
            <StatTile label="Oturdu" value={String(s?.seated ?? 0)} tone="good" />
            <StatTile label="Gelmedi" value={String(s?.noShow ?? 0)} tone="warn" />
            <StatTile
              label="Gelmeme oranı"
              value={s?.noShowRate != null ? pct(s.noShowRate) : "—"}
              tone={(s?.noShowRate ?? 0) > 20 ? "bad" : "default"}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
