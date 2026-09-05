"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Minus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import { FinansalTrendChart } from "@/components/raporlar/finansal-trend-chart"
import { NakitProjeksiyonChart } from "@/components/raporlar/nakit-projeksiyon-chart"
import { reportHubLinks } from "@/lib/nav/report-hubs"
import { DEFAULT_PERIOD, PERIOD_PRESETS, percentChange, type PeriodPresetKey } from "@/lib/raporlar/donem"
import type { FinancialOverviewResult } from "@/lib/raporlar/finansal-ozet"

/** Başlıklar `lib/nav/report-hubs.ts`te: üst hub da aynı listeyi süzerek çiziyor. */
const DETAIL_REPORTS = reportHubLinks("/raporlar/finansal")

const money = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value)

/**
 * KPI kartı. `delta` verilirse önceki döneme göre yüzde değişim rozetle basılır;
 * `null` (önceki dönem sıfır) ise rozet HİÇ çizilmez — "%∞ artış" yazmak yerine
 * susmak doğru olan.
 */
function KpiCard({
  title,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  tone = "neutral",
}: {
  title: string
  value: number
  delta?: number | null
  deltaLabel?: string
  icon: typeof Wallet
  tone?: "neutral" | "good" | "bad"
}) {
  const toneClass =
    tone === "good"
      ? "text-green-600 dark:text-green-400"
      : tone === "bad"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground"

  const DeltaIcon = delta == null ? Minus : delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus
  const deltaClass =
    delta == null || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-green-600 dark:text-green-400"
        : "text-red-600 dark:text-red-400"

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className={`text-2xl font-bold ${toneClass}`}>{money(value)}</p>
        {delta !== undefined && delta !== null && (
          <p className={`flex items-center gap-1 text-xs ${deltaClass}`}>
            <DeltaIcon className="h-3 w-3" />
            {Math.abs(delta).toFixed(1)}% <span className="text-muted-foreground">{deltaLabel}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Alacak/borç kartı: açık toplam, altında vadesi geçmiş ve yaklaşan kırılımı. */
function PartyCard({
  title,
  party,
  href,
  canOpen,
  companyId,
}: {
  title: string
  party: FinancialOverviewResult["receivables"]
  href: string
  canOpen: boolean
  companyId: string
}) {
  const body = (
    <Card className={canOpen ? "h-full transition-colors hover:border-kobipo-blue/60" : "h-full"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-bold">{money(party.open)}</p>
        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {party.overdue > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
              Vadesi geçmiş
            </span>
            <span className={party.overdue > 0 ? "font-medium text-amber-600 dark:text-amber-400" : ""}>
              {money(party.overdue)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">30 gün içinde</span>
            <span>{money(party.dueSoon)}</span>
          </div>
          {/* Vadesiz belgeler yalnız VARSA yazılır: vadesi eksiksiz girilmiş
              firmada her karta sıfırlı bir satır eklemek gürültüdür. */}
          {party.noDueDate > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Vade tanımsız</span>
              <span>{money(party.noDueDate)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )

  if (!canOpen) return body
  return (
    <Link href={`${href}?company=${encodeURIComponent(companyId)}`} className="block">
      {body}
    </Link>
  )
}

export default function FinansalRaporlarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  // Menüsüz kavşak sayfası DEĞİL artık (2026-09-05'te menüye eklendi) ama alt
  // rapor linkleri hâlâ süzülür: kapalı bir rapora tıklayan kullanıcı sayfa
  // kapısına çarpıp panoya dönerdi.
  const canOpen = useRouteAccess()
  const reports = DETAIL_REPORTS.filter((report) => canOpen(report.href))

  const [period, setPeriod] = useState<PeriodPresetKey>(DEFAULT_PERIOD)
  const [data, setData] = useState<FinancialOverviewResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ companyId, period })
      const response = await fetch(`/api/raporlar/finansal-ozet?${params}`)
      if (!response.ok) throw new Error("Rapor alınamadı")
      setData(await response.json())
    } catch (err) {
      console.error("Finansal özet alınamadı:", err)
      setError("Rapor alınamadı. Lütfen tekrar deneyin.")
    } finally {
      setIsLoading(false)
    }
  }, [companyId, period])

  useEffect(() => {
    load()
  }, [load])

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const pl = data?.profitLoss
  const revenueDelta = data ? percentChange(pl!.revenue.total, data.previous.revenue) : null
  const grossDelta = data ? percentChange(pl!.grossProfit, data.previous.grossProfit) : null
  const netDelta = data ? percentChange(pl!.netProfit, data.previous.netProfit) : null
  // Darboğaz: eğri eksiye düşüyorsa hangi haftada düştüğünü söyle.
  const lowest = data?.projection.lowestPoint
  const shortfall = lowest && lowest.balance < 0 ? lowest : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Finansal Raporlar</h1>
          <p className="text-muted-foreground">
            Dönemin özeti ve mali tablolara giriş.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {PERIOD_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              size="sm"
              variant={period === preset.key ? "default" : "outline"}
              onClick={() => setPeriod(preset.key)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button size="sm" variant="outline" onClick={load}>
              Tekrar dene
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[116px] animate-pulse rounded-lg border bg-muted/40" />
          ))}
        </div>
      ) : null}

      {data && pl && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Ciro"
              value={pl.revenue.total}
              delta={revenueDelta}
              deltaLabel={data.previous.label}
              icon={TrendingUp}
            />
            <KpiCard
              title="Brüt Kâr"
              value={pl.grossProfit}
              delta={grossDelta}
              deltaLabel={data.previous.label}
              icon={pl.grossProfit >= 0 ? TrendingUp : TrendingDown}
              tone={pl.grossProfit >= 0 ? "good" : "bad"}
            />
            <KpiCard
              title="Net Kâr / Zarar"
              value={pl.netProfit}
              delta={netDelta}
              deltaLabel={data.previous.label}
              icon={pl.netProfit >= 0 ? TrendingUp : TrendingDown}
              tone={pl.netProfit >= 0 ? "good" : "bad"}
            />
            <KpiCard
              title="Kasa + Banka"
              value={data.cash.total}
              icon={Wallet}
              tone={data.cash.total >= 0 ? "neutral" : "bad"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <PartyCard
              title="Açık Alacaklar"
              party={data.receivables}
              href="/raporlar/cari-yaslandirma"
              canOpen={canOpen("/raporlar/cari-yaslandirma")}
              companyId={companyId}
            />
            <PartyCard
              title="Açık Borçlar"
              party={data.payables}
              href="/raporlar/cari-yaslandirma"
              canOpen={canOpen("/raporlar/cari-yaslandirma")}
              companyId={companyId}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Banknote className="h-4 w-4" />
                  Kasa ve Banka Hesapları
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.cash.accounts.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Tanımlı hesap yok.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.cash.accounts.map((account) => (
                      <li key={account.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-muted-foreground">{account.name}</span>
                        <span className="shrink-0 font-medium">{money(account.balance)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Gelir / Gider Trendi</CardTitle>
              <CardDescription>
                Son 12 ay — gelir ve gider sütunlarda, kâr çizgide.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FinansalTrendChart data={data.monthly} />
            </CardContent>
          </Card>

          {/* Geçmiş trendin YANINDA ileriye dönük eğri: "geçen yıl iyiydi" ile
              "önümüzdeki ay param bitiyor" ayrı sorulardır. */}
          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Nakit Projeksiyonu — 12 Hafta</CardTitle>
                <CardDescription>
                  Bugünkü nakitten başlayarak açık alacak/borçların vadesine göre dağılımı.
                  Vadesi geçmiş ({money(data.projection.overdue.inflow)} alacak,{" "}
                  {money(data.projection.overdue.outflow)} borç) ve vadesi tanımsız tutarlar
                  eğriye dahil değildir.
                </CardDescription>
              </div>
              {canOpen("/raporlar/nakit-akisi") && (
                <Link
                  href={`/raporlar/nakit-akisi?company=${encodeURIComponent(companyId)}`}
                  className="shrink-0 text-sm font-medium text-kobipo-blue hover:underline"
                >
                  Ayrıntı →
                </Link>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {shortfall && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                  <p className="text-red-900 dark:text-red-200">
                    <strong>{shortfall.label}</strong> haftasında nakit {money(shortfall.balance)}{" "}
                    seviyesine, yani eksiye düşüyor.
                  </p>
                </div>
              )}
              <NakitProjeksiyonChart data={data.projection.buckets} />
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detay Raporlar</CardTitle>
          <CardDescription>Her başlık kendi rapor sayfasına yönlendirir.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {reports.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground md:col-span-2">
              Bu bölümde görüntüleyebileceğiniz bir rapor yok.
            </p>
          ) : null}
          {reports.map((report) => (
            <Link
              key={report.href}
              href={`${report.href}?company=${encodeURIComponent(companyId)}`}
              className="block rounded-lg border p-4 transition-colors hover:border-kobipo-blue/60"
            >
              <p className="font-semibold">{report.title}</p>
              <p className="text-sm text-muted-foreground">{report.description}</p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
