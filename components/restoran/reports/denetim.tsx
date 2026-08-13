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
import { CompanyLink } from "@/components/dashboard/company-link"
import { DiscountLimitCard } from "@/components/restoran/discount-limit-card"
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

/** İskontoyu UYGULAYAN personel — İK kartı. `Staff` (login kullanıcısı) ile aynı küme değil. */
type DiscountStaff = {
  employeeId: string | null
  name: string
  position: string | null
  count: number
  value: number
}

type Discount = {
  id: string
  code: string
  closedAt: string | null
  tableName: string | null
  type: "PERCENT" | "AMOUNT" | null
  rate: number | null
  reasonLabel: string | null
  reason: string | null
  employeeName: string | null
  value: number
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
    discountCount: number
    discountTotal: number
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
  discounts: Discount[]
  discountReasons: { code: string | null; label: string; count: number; value: number }[]
  discountStaff: DiscountStaff[]
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

/** Rapor bulgusundan KAYNAĞA tek tıkla inilir: kod → adisyonun detay sayfası. */
function TicketCodeLink({ id, code }: { id: string; code: string }) {
  return (
    <CompanyLink
      href={`/restoran/adisyon/${id}`}
      className="font-medium underline-offset-4 hover:underline"
    >
      {code}
    </CompanyLink>
  )
}

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
  const discounts = data?.discounts ?? []
  const discountStaff = data?.discountStaff ?? []
  const staff = data?.staff ?? []
  const maxCost = Math.max(0, ...products.map((p) => p.cost))
  const maxDiscount = Math.max(0, ...discountStaff.map((d) => d.value))

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
    merged.length === 0 &&
    discounts.length === 0

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        İskonto, ikram, zayi, iptal ve personel kırılımı. <strong>Maliyet</strong> satış anında
        dondurulmuş alış maliyetidir (AVCO); ciroya girmez, kâra girmez —{" "}
        <strong>karşılıksız harcanan malzemedir</strong>. İptal edilen fişin ikramı da geri
        alınır, bu rapora girmez.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Verilen iskonto"
          value={money(s?.discountTotal ?? 0)}
          hint={`${s?.discountCount ?? 0} adisyon · KDV dahil`}
          tone={(s?.discountTotal ?? 0) > 0 ? "warn" : "default"}
        />
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

      {/* Ölçüm ile KURAL yan yana: patron verilen iskontoyu görüp sınırı aynı
          ekrandan çekebilsin. Rapor aralığından bağımsız (tavan bir ayardır),
          o yüzden `range` almıyor. */}
      <DiscountLimitCard />

      <ReportState
        isLoading={isLoading}
        error={error}
        empty={empty}
        emptyText="Bu aralıkta ikram, zayi, iptal veya iskonto kaydı yok."
      />

      {discountStaff.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>İskonto veren personel</CardTitle>
            <CardDescription>
              İskontoyu uygulayan personelin İK kartına göre — aşağıdaki &quot;Personel&quot;
              tablosundan AYRIDIR (orası adisyonu açan/kapatan <em>kullanıcı</em> hesabıdır).
              Tezgâh (Kahveci Satış) iskontosunun kaydı tutulmadığı için burada görünmez.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Personel</StyledTableHead>
                    <StyledTableHead>Görev</StyledTableHead>
                    <StyledTableHead className="text-right">Adisyon</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                    <StyledTableHead className="w-32">Pay</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {discountStaff.map((d) => (
                    <StyledTableRow key={d.employeeId ?? "unknown"}>
                      <TableCell
                        className={d.employeeId ? "font-medium" : "font-medium text-muted-foreground"}
                      >
                        {d.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.position ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.count}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(d.value)}
                      </TableCell>
                      <TableCell>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-kobipo-blue dark:bg-primary"
                            style={{
                              width: `${maxDiscount > 0 ? (d.value / maxDiscount) * 100 : 0}%`,
                            }}
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

      {discounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>İskontolu adisyonlar</CardTitle>
            <CardDescription>
              Yalnız KAPANMIŞ hesaplar: açık adisyondaki iskonto hâlâ değiştirilebilir, iptal
              edilende ise tahsil edilmeyen bir para yoktur.
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
                    <StyledTableHead>Personel</StyledTableHead>
                    <StyledTableHead>Sebep</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {discounts.map((d) => (
                    <StyledTableRow key={d.id}>
                      <TableCell>
                        <TicketCodeLink id={d.id} code={d.code} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.tableName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{dayTime(d.closedAt)}</TableCell>
                      <TableCell
                        className={d.employeeName ? undefined : "italic text-muted-foreground"}
                      >
                        {d.employeeName ?? "Belirtilmemiş"}
                      </TableCell>
                      <TableCell>
                        {d.reasonLabel ?? "—"}
                        {d.reason ? (
                          <span className="ml-2 text-xs text-muted-foreground">{d.reason}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(d.value)}
                        {d.rate != null ? (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            %{d.rate}
                          </span>
                        ) : null}
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          </CardContent>
        </Card>
      )}

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
                      <TableCell>
                        <TicketCodeLink id={c.id} code={c.code} />
                      </TableCell>
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
                      <TableCell>
                        <TicketCodeLink id={m.id} code={m.code} />
                      </TableCell>
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
