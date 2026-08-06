"use client"

// Personel kartının RESTORAN sekmesi — bu personelin uyguladığı hesap iskontoları.
//
// İK kartı bugüne kadar operasyondan tamamen kopuktu (bordro, izin, zimmet,
// belge). Bu sekme ilk bağ: "iskontoyu kim verdi" sorusunun cevabı adisyonda
// duruyordu ama personelin kendi sayfasından görünmüyordu.
//
// Sekmenin kendisi restoran modülü kapalıyken çizilmez (uç `enabled: false`
// döner) — İK ekranı, kullanılmayan bir modülün boş tablosunu göstermemeli.

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"

export type RestoranActivity = {
  enabled: boolean
  months?: number
  truncated?: boolean
  summary: { count: number; total: number } | null
  monthly: { month: string; count: number; total: number }[]
  discounts: {
    id: string
    code: string
    closedAt: string | null
    tableName: string | null
    rate: number | null
    reasonLabel: string | null
    reason: string | null
    value: number
    share: number
  }[]
}

const money = (v: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(v)

const dayTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—"

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-")
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("tr-TR", {
    month: "long",
    year: "numeric",
  })
}

/**
 * Veriyi çeken hook. Sekme ETİKETİ de sayıyı gösterdiği için veri sayfanın
 * üstünde lazım — bu yüzden çekim bileşenin içinde değil, burada dışa açık.
 */
export function useRestoranActivity(employeeId: string, companyId: string | null) {
  const [data, setData] = useState<RestoranActivity | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch(
      `/api/personel/employees/${employeeId}/restoran${companyId ? `?companyId=${companyId}` : ""}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, companyId])

  return { data, isLoading }
}

export function EmployeeRestoranTab({ data }: { data: RestoranActivity }) {
  const { summary, monthly, discounts } = data

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Verilen iskonto</p>
            <p className="text-2xl font-bold tabular-nums">{money(summary?.total ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              son {data.months ?? 6} ay · KDV dahil
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">İskontolu adisyon</p>
            <p className="text-2xl font-bold tabular-nums">{summary?.count ?? 0}</p>
            <p className="text-xs text-muted-foreground">kapanmış hesap</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Ortalama iskonto</p>
            <p className="text-2xl font-bold tabular-nums">
              {summary && summary.count > 0 ? money(summary.total / summary.count) : money(0)}
            </p>
            <p className="text-xs text-muted-foreground">adisyon başına</p>
          </CardContent>
        </Card>
      </div>

      {discounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Bu personel adına kayıtlı iskonto yok.
          </CardContent>
        </Card>
      ) : (
        <>
          {monthly.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Aylık</CardTitle>
              </CardHeader>
              <CardContent>
                <StyledTableContainer>
                  <Table>
                    <TableHeader>
                      <StyledTableHeaderRow>
                        <StyledTableHead>Ay</StyledTableHead>
                        <StyledTableHead className="text-right">Adisyon</StyledTableHead>
                        <StyledTableHead className="text-right">Tutar</StyledTableHead>
                      </StyledTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                      {monthly.map((m) => (
                        <StyledTableRow key={m.month}>
                          <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {money(m.total)}
                          </TableCell>
                        </StyledTableRow>
                      ))}
                    </TableBody>
                  </Table>
                </StyledTableContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">İskontolu adisyonlar</CardTitle>
              <CardDescription>
                Yalnız kapanmış hesaplar — açık adisyondaki iskonto hâlâ değiştirilebilir.
                {data.truncated ? " Liste ilk 100 kayıtla sınırlı." : ""}
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
                      <StyledTableHead className="text-right">Tutar</StyledTableHead>
                      <StyledTableHead className="text-right">Hesabın %&apos;si</StyledTableHead>
                    </StyledTableHeaderRow>
                  </TableHeader>
                  <TableBody>
                    {discounts.map((d) => (
                      <StyledTableRow key={d.id}>
                        <TableCell className="font-medium">{d.code}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.tableName ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {dayTime(d.closedAt)}
                        </TableCell>
                        <TableCell>
                          {d.reasonLabel ?? "—"}
                          {d.reason ? (
                            <span className="ml-2 text-xs text-muted-foreground">{d.reason}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {money(d.value)}
                        </TableCell>
                        {/* İskontonun hesaba oranı: %5'lik indirimle %50'lik aynı
                            sütunda okunmasın — asıl bulgu tutarda değil, oranda.
                            Yüzde iskontoda `rate` ile aynı çıkar, o yüzden `rate`
                            burada ayrıca basılmaz (aynı sayı iki kez okunurdu);
                            tutar iskontosunda ise tek anlamlı oran budur. */}
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          %{d.share}
                        </TableCell>
                      </StyledTableRow>
                    ))}
                  </TableBody>
                </Table>
              </StyledTableContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
