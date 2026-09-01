"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ArrowUpRight,
  CalendarRange,
  ChevronRight,
  ListTree,
  Receipt,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"
import { ExportButton } from "@/components/export/export-button"
import { withCompanyHref } from "@/lib/company/href"
import type { SalesPurchaseKind, SalesPurchaseResult } from "@/lib/raporlar/satis-alis"
import {
  salesPurchaseSections,
  sectionPath,
  type SalesPurchaseSection,
  type SalesPurchaseSectionKey,
} from "@/lib/raporlar/satis-alis-sections"

/**
 * Satış ve alış rapor ekranının ORTAK gövdesi. İki ekran tek farkla (`kind`) aynı
 * şeyi çiziyordu; kopya duruyorken satışa eklenen her sütun alışta eksik kalıyordu.
 *
 * Rakamlar `/api/raporlar/satis-alis` üzerinden gelir; dışa aktarma da aynı
 * hesabı (`lib/raporlar/satis-alis.ts`) çağırdığı için ekran ile dosya birebir
 * aynıdır — tarih aralığı ikisine birden uygulanır.
 *
 * DÜZEN: Excel'deki her sayfa ekranda iki yerden açılır — özetin üstündeki
 * "Rapor bölümleri" şeridi ve (özeti olan bölümlerde) kartın başlığındaki link.
 * Kartlar özet, alt sayfa tam liste gösterir; üçü de aynı bölüm listesinden
 * (`lib/raporlar/satis-alis-sections.ts`) doğar.
 */

const TL = (value: number, digits = 2) =>
  `₺${value.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

const isoDay = (date: Date) => date.toISOString().split("T")[0]

/** Cari kartındaki iki tanım tek satırda: "Bayi · Marmara". İkisi de boşsa "". */
const classText = (class1: string, class2: string) => [class1, class2].filter(Boolean).join(" · ")

/** Bölüm kapılarının ikonu. Anahtarlar bölüm listesinden gelir, kart eklenirse burası da uyarır. */
const sectionIcons: Record<SalesPurchaseSectionKey, LucideIcon> = {
  aylik: CalendarRange,
  cariler: Users,
  faturalar: Receipt,
  kalemler: ListTree,
}

type Props = {
  kind: SalesPurchaseKind
  companyId: string
}

/** Kartın başlığı: bölümün alt sayfasına giden link + kısa açıklama. */
function SectionCardHeader({
  section,
  href,
  hint,
}: {
  section: SalesPurchaseSection
  href: string
  hint?: string
}) {
  return (
    <CardHeader>
      <CardTitle>
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
        >
          {section.title}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </CardTitle>
      <CardDescription>{hint ?? section.description}</CardDescription>
    </CardHeader>
  )
}

export function SatisAlisReport({ kind, companyId }: Props) {
  const isSales = kind === "SALES"
  const [report, setReport] = useState<SalesPurchaseResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // Dönem varsayılanı yılbaşı → bugün (kar/zarar ekranıyla aynı alışkanlık).
  const [startDate, setStartDate] = useState(() => isoDay(new Date(new Date().getFullYear(), 0, 1)))
  const [endDate, setEndDate] = useState(() => isoDay(new Date()))

  const fetchReport = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId, type: kind })
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)
      const res = await fetch(`/api/raporlar/satis-alis?${params}`, { cache: "no-store" })
      if (!res.ok) throw new Error(await res.text())
      setReport(await res.json())
    } catch (error) {
      console.error("Satış/alış raporu alınamadı:", error)
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }, [companyId, kind, startDate, endDate])

  useEffect(() => {
    void fetchReport()
  }, [fetchReport])

  const monthly = report?.monthly ?? []
  const topCounterparties = useMemo(() => (report?.topCounterparties ?? []).slice(0, 5), [report])
  // En son belgeler — detaya (fatura önizlemesi) gitmek için. Liste zaten
  // tarihe göre azalan gelir.
  const recentInvoices = useMemo(() => (report?.invoices ?? []).slice(0, 10), [report])
  const maxMonthly = Math.max(0, ...monthly.map((m) => m.amount))

  const sections = useMemo(() => salesPurchaseSections(kind), [kind])
  const sectionOf = (key: SalesPurchaseSectionKey) => sections.find((s) => s.key === key)!
  // Kart linki o an seçili dönemi de taşır; alt sayfa aynı aralıkla açılır ve
  // kullanıcı filtreyi ikinci kez kurmak zorunda kalmaz.
  const hrefOf = (key: SalesPurchaseSectionKey) => {
    const query = new URLSearchParams()
    if (startDate) query.set("startDate", startDate)
    if (endDate) query.set("endDate", endDate)
    const suffix = query.toString()
    return withCompanyHref(
      `${sectionPath(kind, sectionOf(key))}${suffix ? `?${suffix}` : ""}`,
      companyId
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">
            {isSales ? "Satış Raporları" : "Alış Raporları"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSales
              ? "Fatura, detay, iade ve satışçı performansı için özet veriler"
              : "Fatura, detay ve iade hareketleri için özet veriler"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            dataset={isSales ? "rapor-satis" : "rapor-alis"}
            companyId={companyId}
            size="default"
            params={{ startDate, endDate }}
          />
          <Link href={withCompanyHref(`/${isSales ? "satis" : "alis"}/fatura`, companyId)}>
            <Button variant="outline">
              {isSales ? "Tüm satış faturaları" : "Tüm alış faturaları"}
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="rapor-baslangic">Başlangıç tarihi</Label>
            <Input
              id="rapor-baslangic"
              type="date"
              className="w-[170px]"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rapor-bitis">Bitiş tarihi</Label>
            <Input
              id="rapor-bitis"
              type="date"
              className="w-[170px]"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={fetchReport} disabled={isLoading}>
            {isLoading ? "Yükleniyor…" : "Raporu getir"}
          </Button>
          {/* Dönemi tamamen kaldırmak: "tüm kayıtlar" görünümü. Dosya da aynı
              boş aralıkla üretilir, ekranla dosya ayrışmaz. */}
          <Button
            variant="ghost"
            onClick={() => {
              setStartDate("")
              setEndDate("")
            }}
            disabled={isLoading || (!startDate && !endDate)}
          >
            Tüm kayıtlar
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isSales ? "Toplam Satış" : "Toplam Alış"}
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                {TL(report?.totalAmount ?? 0)}
              </p>
            </div>
            <span className="rounded-xl bg-kobipo-blue/10 p-2.5 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              {isSales ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fatura Adedi</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{report?.count ?? 0}</p>
            </div>
            <span className="rounded-xl bg-amber-100 p-2.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Receipt className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isSales ? "Aktif Müşteri" : "Aktif Tedarikçi"}
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                {report?.topCounterparties.length ?? 0}
              </p>
            </div>
            <span className="rounded-xl bg-kobipo-green/10 p-2.5 text-kobipo-green-dark dark:bg-emerald-900/30 dark:text-emerald-300">
              {isSales ? <Users className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Bölüm kapıları. Dört bölüm de (Excel'in dört sayfası) ÖZETİN ÜSTÜNDE tek
          şeritte duruyor: "Detaylı Faturalar" en altta, kalem özeti olmayan boş bir
          kartın içindeyken fark edilmiyordu. Kart başlıklarındaki linkler duruyor —
          iki yol da aynı bölüm listesinden doğuyor. */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rapor bölümleri
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => {
            const Icon = sectionIcons[section.key]
            return (
              <Link
                key={section.key}
                href={hrefOf(section.key)}
                className="group flex items-start gap-3 rounded-xl border bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-kobipo-blue/50 hover:shadow-md"
              >
                <span className="shrink-0 rounded-lg bg-muted p-2 text-muted-foreground transition-colors group-hover:bg-kobipo-blue/10 group-hover:text-kobipo-blue dark:group-hover:bg-primary/15 dark:group-hover:text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">
                    {section.title}
                    <ChevronRight className="ml-1 inline-block h-3.5 w-3.5 align-[-2px] text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    {section.description}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <Card>
        <SectionCardHeader section={sectionOf("aylik")} href={hrefOf("aylik")} />
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : monthly.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Bu dönemde kayıt yok</p>
          ) : (
            <div className="space-y-2.5">
              {monthly.map((m) => {
                const pct = maxMonthly > 0 ? Math.round((m.amount / maxMonthly) * 100) : 0
                return (
                  <div key={m.sortKey} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{m.label}</span>
                      <span className="font-mono tabular-nums">
                        ₺{m.amount.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                        <span className="ml-2 text-muted-foreground">{m.count} fatura</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-kobipo-blue to-kobipo-mid"
                        style={{ width: `${Math.max(0, pct)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <SectionCardHeader
          section={sectionOf("cariler")}
          href={hrefOf("cariler")}
          hint="İlk 5 — tümü için başlığa tıklayın"
        />
        <CardContent>
          {topCounterparties.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Veri yok</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {topCounterparties.map((row, idx) => (
                <li key={row.name} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.name}</p>
                      {/* Tanımlar: cari kartındaki sınıflandırmalar (Ayarlar → Tanımlar).
                          Excel'de ayrı iki sütun, ekranda tek satır. */}
                      {classText(row.class1, row.class2) ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {classText(row.class1, row.class2)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums">{TL(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <SectionCardHeader
          section={sectionOf("faturalar")}
          href={hrefOf("faturalar")}
          hint="Son 10 fatura — dönemin tamamı için başlığa tıklayın"
        />
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : recentInvoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Bu dönemde kayıt yok</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {recentInvoices.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={withCompanyHref(`/faturalar/${inv.id}/onizleme`, companyId)}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {inv.counterpartyName}
                        {classText(inv.class1, inv.class2) ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                            {classText(inv.class1, inv.class2)}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {inv.invoiceNo} ·{" "}
                        {new Date(inv.date).toLocaleDateString("tr-TR", { dateStyle: "medium" })}
                        {inv.isReturn ? " · İade" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {TL(inv.totalAmount)}
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
