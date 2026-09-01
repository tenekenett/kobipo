"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/export/export-button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ChevronDown, ChevronLeft, ChevronRight, User, FileText, RotateCcw } from "lucide-react"
import { useCanView } from "@/components/dashboard/dashboard-company-provider"
import { useClassificationLabels } from "@/lib/swr/use-company-data"
import { buildPaymentPlan, formatPlanMonth } from "@/lib/raporlar/cari-yaslandirma-plan"
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  type AgingBucket,
} from "@/lib/raporlar/cari-yaslandirma-buckets"
import Link from "next/link"
import { cn } from "@/lib/utils"

type Bucket = AgingBucket

type Totals = Record<Bucket, number> & {
  /** Ölçülebilen gecikme kovalarının toplamı. */
  overdue: number
  overdueAvgDays: number
  performanceAvgDays: number
  performanceScore: number
  performanceLabel: string
  total: number
  /** Çift rollü caride karşı yöndeki açık belgelerin mahsup ettiği tutar. */
  offsetCredit: number
}

type AgingInvoice = {
  id: string
  invoiceNo: string
  date: string
  effectiveDueDate: string
  totalAmount: number
  paidAmount: number
  openAmount: number
  overdueDays: number
  bucket: Bucket
  /** Vade gerçekten tanımlı mı — plan dilimleri buna bakar. */
  hasDueDate: boolean
}

type AgingAccount = {
  id: string
  name: string
  code: string | null
  paymentDueDays: number | null
  taxNumber: string | null
  /** Cari kartındaki sınıflandırmalar (Ayarlar → Tanımlar); tanımsızsa boş string. */
  class1: string
  class2: string
  totals: Totals
  invoices: AgingInvoice[]
}

type AgingResponse = {
  asOf: string
  customers: { accounts: AgingAccount[]; totals: Totals }
  suppliers: { accounts: AgingAccount[]; totals: Totals }
  /** Sayılmayan satış taslakları — cari kartındaki bakiye bunları içerir. */
  excludedDrafts?: { count: number; amount: number }
}

// Kova listesi ve etiketleri TEK kaynaktan (`cari-yaslandirma-buckets.ts`):
// burada kopya durduğunda kova eklenince biri güncellenip diğeri unutulurdu.
const BUCKETS = AGING_BUCKETS
const BUCKET_LABEL = AGING_BUCKET_LABEL

// Yaşlandıkça koyulaşan tek bir skala: kullanıcı rengi okuyup sırayı anlayabilsin.
const BUCKET_TONE: Record<Bucket, string> = {
  not_due: "text-emerald-600",
  d1_30: "text-amber-600",
  d31_60: "text-orange-600",
  d61_90: "text-red-600",
  d90_plus: "text-red-700",
  no_due: "text-slate-500",
}

const BUCKET_BADGE: Record<Bucket, string> = {
  not_due: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-200",
  d1_30: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 border border-amber-200",
  d31_60: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300 border border-orange-200",
  d61_90: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 border border-red-200",
  d90_plus: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-200 border border-red-300",
  no_due: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border border-slate-200",
}

function fmtTRY(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
  }).format(value || 0)
}

function fmtDate(value: string) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("tr-TR")
}

function fmtDays(value: number) {
  if (!Number.isFinite(value)) return "-"
  if (value > 0) return `+${value.toFixed(1)} gün`
  if (value < 0) return `${value.toFixed(1)} gün`
  return "0.0 gün"
}

export default function CariYaslandirmaPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [data, setData] = useState<AgingResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { labels: classLabels } = useClassificationLabels(companyId)
  const [tab, setTab] = useState<"customers" | "suppliers">("customers")
  // Satış taslakları varsayılan olarak SAYILMAZ: taslak henüz kesilmemiş belgedir,
  // "vadesi geçmiş alacak" olarak göstermek borcu olmayan müşteriyi borçlu yapıyordu.
  const [includeDrafts, setIncludeDrafts] = useState(false)
  /**
   * Planın böldüğü AY. 0 = içinde bulunulan ay; ileri/geri düğmeleri bunu kaydırır.
   * Yaşlandırmanın kendisi bugüne göre hesaplanır, ay yalnız PLANI etkiler —
   * gelecek ayın nakit takvimine bakarken kovaların değişmemesi gerekir.
   */
  const [planOffset, setPlanOffset] = useState(0)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Rapor açık ama cari kartı kapalı olabilir (ör. Gözlemci): satırdaki profil ve
  // ekstre düğmeleri `/cari/*` altına gider, orası ayrı bir sayfa iznidir. Süzmezsek
  // düğme kullanıcıyı sayfa kapısına çarpıp panoya geri attırır.
  const canViewCustomers = useCanView("/cari/musteri")
  const canViewSuppliers = useCanView("/cari/tedarikci")
  const canOpenParty = tab === "customers" ? canViewCustomers : canViewSuppliers
  // Ekstre ekranı `/cari/ekstre`; sahibi müşteri VE tedarikçi kartıdır, biri yeterli.
  const canOpenEkstre = canViewCustomers || canViewSuppliers

  useEffect(() => {
    if (!companyId) {
      setData(null)
      return
    }
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/raporlar/cari-yaslandirma?companyId=${encodeURIComponent(companyId)}${
            includeDrafts ? "&includeDrafts=1" : ""
          }`,
          { cache: "no-store" }
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Hata: ${res.status}`)
        }
        const json = (await res.json()) as AgingResponse
        setData(json)
      } catch (e: any) {
        setError(e.message || "Yaşlandırma verisi yüklenemedi")
        setData(null)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [companyId, includeDrafts])

  const current = useMemo(() => {
    if (!data) return null
    return tab === "customers" ? data.customers : data.suppliers
  }, [data, tab])

  /**
   * Ay içi ödeme planı: bulunduğumuz ayı 1-10 / 11-20 / 21-ay sonu diye böler ve
   * her carinin o dilime VADESİ DÜŞEN açık tutarını toplar. Excel'de iki ayrı
   * sayfa olarak vardı ama ekranda yoktu; aynı fonksiyondan hesaplanıyor ki
   * dosyayla ekran ayrışmasın.
   */
  const planMonth = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + planOffset, 1)
  }, [planOffset])
  const planMonthLabel = planMonth.toLocaleDateString("tr-TR", { month: "long", year: "numeric" })
  const plan = useMemo(
    () => (current ? buildPaymentPlan(current.accounts, planMonth) : null),
    [current, planMonth]
  )
  const planRows = useMemo(
    () => (plan ? plan.rows.filter((row) => row.total > 0) : []),
    [plan]
  )
  const planTotals = useMemo(() => {
    const base = { noDue: 0, pastMonths: 0, period1: 0, period2: 0, period3: 0, monthTotal: 0, nextMonths: 0, total: 0 }
    for (const row of planRows) {
      base.noDue += row.noDue
      base.pastMonths += row.pastMonths
      base.period1 += row.period1
      base.period2 += row.period2
      base.period3 += row.period3
      base.monthTotal += row.monthTotal
      base.nextMonths += row.nextMonths
      base.total += row.total
    }
    return base
  }, [planRows])

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Cari Yaşlandırma</h1>
          <p className="text-muted-foreground">
            Açık faturalardan üretilen, vadeye göre yaşlandırma raporu
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Dosya her iki sekmeyi de içerir (Alacaklar + Borçlar); rapor
              zaten tek hesaplamadan çıkıyor, ikiye bölmek anlamsız olurdu. */}
          <ExportButton
            dataset="rapor-cari-yaslandirma"
            companyId={companyId}
            disabled={!data}
            params={{
              includeDrafts: includeDrafts ? "1" : "",
              // Dosyadaki plan sayfaları ekranda seçili AYI böler.
              planMonth: formatPlanMonth(planMonth),
            }}
          />
          {data?.asOf ? (
            <div className="text-xs text-muted-foreground">
              Hesaplama tarihi: {new Date(data.asOf).toLocaleString("tr-TR")}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
        <div className="flex gap-2">
          <Button
            variant={tab === "customers" ? "default" : "ghost"}
            onClick={() => setTab("customers")}
          >
            Müşteriler
          </Button>
          <Button
            variant={tab === "suppliers" ? "default" : "ghost"}
            onClick={() => setTab("suppliers")}
          >
            Tedarikçiler
          </Button>
        </div>
        {/* Taslak satış faturaları: varsayılan HARİÇ. Alış tarafında taslak
            "Kayıtlı" demek olduğu için orada ayıklama yapılmaz. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={includeDrafts}
            onChange={(e) => setIncludeDrafts(e.target.checked)}
            disabled={isLoading}
          />
          Satış taslaklarını da say
        </label>
      </div>

      {/* Rapor taslakları saymıyor ama cari kartındaki bakiye SAYIYOR. Fark
          söylenmezse kullanıcı iki ekranda iki rakam görüp hangisinin doğru
          olduğunu bilemez. */}
      {!includeDrafts && data?.excludedDrafts && data.excludedDrafts.count > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span>
            <span className="font-medium">{data.excludedDrafts.count} taslak satış faturası</span>{" "}
            ({fmtTRY(data.excludedDrafts.amount)}) bu raporda sayılmıyor — cari kartındaki bakiye
            bunları içerir.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setIncludeDrafts(true)}
          >
            Taslakları da say
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {isLoading && !data ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Yükleniyor...
          </CardContent>
        </Card>
      ) : null}

      {current ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Toplam Açık" value={current.totals.total} tone="text-foreground" />
            {BUCKETS.map((b) => (
              <SummaryCard
                key={b}
                label={BUCKET_LABEL[b]}
                value={current.totals[b]}
                tone={BUCKET_TONE[b]}
              />
            ))}
            <SummaryCard
              label="Vadesi Geçmiş (toplam)"
              value={current.totals.overdue}
              tone="text-red-600"
            />
            <InfoCard
              label="Vadesi Geçmiş Ortalama"
              primary={fmtDays(current.totals.overdueAvgDays)}
              secondary={fmtTRY(current.totals.overdue)}
            />
            <InfoCard
              label="Geri Dönüş"
              primary={`${current.totals.performanceScore}/100 · ${current.totals.performanceLabel}`}
              secondary={fmtDays(current.totals.performanceAvgDays)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                {tab === "customers" ? "Müşteri Yaşlandırması" : "Tedarikçi Yaşlandırması"}
              </CardTitle>
              <CardDescription>
                Hesap bazında açık tutar, gecikme dilimleri ve ödeme performansı.
                Vadesi hiç tanımlanmamış belgeler ayrı sütunda durur; gecikmiş
                sayılmaz.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Hesap</TableHead>
                    {/* Tanımlar: cari kartındaki sınıflandırmalar (Ayarlar → Tanımlar).
                        Başlık firmanın verdiği EKSEN adıdır; Excel'de de aynısı yazar. */}
                    <TableHead>{classLabels.class1}</TableHead>
                    <TableHead>{classLabels.class2}</TableHead>
                    <TableHead className="text-right">Toplam Açık</TableHead>
                    {/* Yaşlandırmanın kendisi: hangi para ne kadar eskidi. */}
                    {BUCKETS.map((b) => (
                      <TableHead key={b} className="text-right whitespace-nowrap">
                        {BUCKET_LABEL[b]}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Geri Dönüş</TableHead>
                    <TableHead className="text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={13} className="text-center text-muted-foreground">
                        Açık bakiyeli hesap bulunamadı
                      </TableCell>
                    </TableRow>
                  ) : (
                    current.accounts.map((acc) => {
                      const isOpen = Boolean(expanded[acc.id])
                      const partyParam = tab === "customers" ? "customerId" : "supplierId"
                      const from = encodeURIComponent("/raporlar/cari-yaslandirma")
                      const profileHref = `/cari/${tab}/${acc.id}?company=${companyId}&from=${from}`
                      const ekstreHref = `/cari/ekstre?company=${companyId}&${partyParam}=${acc.id}&from=${from}`
                      return (
                        <Fragment key={acc.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => toggle(acc.id)}
                          >
                            <TableCell>
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{acc.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {acc.code ? `${acc.code} · ` : ""}
                                Vade: {acc.paymentDueDays ?? 0} gün
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {acc.class1 || "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {acc.class2 || "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {fmtTRY(acc.totals.total)}
                              {acc.totals.overdue > 0 ? (
                                <div className="text-xs font-normal text-muted-foreground">
                                  Ort. gecikme {fmtDays(acc.totals.overdueAvgDays)}
                                </div>
                              ) : null}
                              {/* Çift rollü cari: karşı yöndeki açık belgeler bu tutarı
                                  mahsup etti. Yazılmazsa "kartta borç yok ama raporda
                                  alacak var" görünür. */}
                              {acc.totals.offsetCredit > 0 ? (
                                <div className="text-xs font-normal text-muted-foreground">
                                  Mahsup {fmtTRY(acc.totals.offsetCredit)}
                                </div>
                              ) : null}
                            </TableCell>
                            {BUCKETS.map((b) => (
                              <TableCell
                                key={b}
                                className={cn(
                                  "text-right tabular-nums",
                                  acc.totals[b] > 0 ? BUCKET_TONE[b] : "text-muted-foreground/50"
                                )}
                              >
                                {acc.totals[b] > 0 ? fmtTRY(acc.totals[b]) : "—"}
                              </TableCell>
                            ))}
                            <TableCell className="text-right tabular-nums">
                              <div className="font-medium">
                                {acc.totals.performanceScore}/100 · {acc.totals.performanceLabel}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {fmtDays(acc.totals.performanceAvgDays)}
                              </div>
                            </TableCell>
                            <TableCell
                              className="text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex justify-end gap-0.5">
                                {canOpenParty ? (
                                  <Link
                                    href={profileHref}
                                    aria-label={tab === "customers" ? "Müşteri profili" : "Tedarikçi profili"}
                                  >
                                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Profil">
                                      <User className="h-4 w-4" />
                                    </Button>
                                  </Link>
                                ) : null}
                                {canOpenEkstre ? (
                                  <Link href={ekstreHref} aria-label="Ekstre / Excel">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Ekstre & Excel">
                                      <FileText className="h-4 w-4" />
                                    </Button>
                                  </Link>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen ? (
                            <TableRow>
                              <TableCell colSpan={13} className="bg-muted/20 p-0">
                                <div className="p-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Fatura No</TableHead>
                                        <TableHead>Tarih</TableHead>
                                        <TableHead>Vade</TableHead>
                                        <TableHead>Geciken Gün</TableHead>
                                        <TableHead>Dilim</TableHead>
                                        <TableHead className="text-right">Tutar</TableHead>
                                        <TableHead className="text-right">Ödenen</TableHead>
                                        <TableHead className="text-right">Açık</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {acc.invoices.length === 0 ? (
                                        <TableRow>
                                          <TableCell colSpan={8} className="text-center text-muted-foreground">
                                            Açık fatura yok
                                          </TableCell>
                                        </TableRow>
                                      ) : (
                                        acc.invoices.map((inv) => (
                                          <TableRow key={inv.id}>
                                            <TableCell className="font-medium">{inv.invoiceNo}</TableCell>
                                            <TableCell>{fmtDate(inv.date)}</TableCell>
                                            <TableCell>{fmtDate(inv.effectiveDueDate)}</TableCell>
                                            <TableCell>
                                              {inv.bucket === "not_due" ? (
                                                <span className="text-xs text-muted-foreground">vadesi gelmedi</span>
                                              ) : inv.bucket === "no_due" ? (
                                                // Vade tanımsız: gün sayısı yazmak "gecikmiş" izlenimi verir.
                                                <span className="text-xs text-muted-foreground">vade yok</span>
                                              ) : (
                                                <span className="text-sm font-medium">{inv.overdueDays}</span>
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              <span
                                                className={cn(
                                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                                  BUCKET_BADGE[inv.bucket]
                                                )}
                                              >
                                                {BUCKET_LABEL[inv.bucket]}
                                              </span>
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                              {fmtTRY(inv.totalAmount)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                              {fmtTRY(inv.paidAmount)}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold tabular-nums">
                                              {fmtTRY(inv.openAmount)}
                                            </TableCell>
                                          </TableRow>
                                        ))
                                      )}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* AY İÇİ ÖDEME PLANI — Excel'deki "Tahsilat/Ödeme Planı" sayfasının
              ekrandaki karşılığı. Ayı ÜÇE böler (1-10 / 11-20 / 21-ay sonu) ve
              her carinin o dilime VADESİ DÜŞEN açık tutarını toplar. Yaşlandırma
              kovalarıyla (1-30/31-60 gün) karıştırılmamalı: orada ölçü GECİKME
              YAŞI, burada TAKVİM. */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {tab === "customers" ? "Ay İçi Tahsilat Planı" : "Ay İçi Ödeme Planı"} ·{" "}
                  <span className="font-normal text-muted-foreground">{planMonthLabel}</span>
                </CardTitle>
                {/* Ay gezinme: gelecek ayın nakit takvimi de görülebilsin. */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Önceki ay"
                    onClick={() => setPlanOffset((v) => v - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Sonraki ay"
                    onClick={() => setPlanOffset((v) => v + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  {planOffset !== 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setPlanOffset(0)}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Bu ay
                    </Button>
                  ) : null}
                </div>
              </div>
              <CardDescription>
                {planMonthLabel} ayında hangi on günlük dilimde ne kadar{" "}
                {tab === "customers" ? "tahsilat" : "ödeme"} beklendiği — vade tarihine göre, firma
                bazlı. Vadesi tanımsız tutarlar dilime giremez, kendi sütununda durur. Dışa
                aktarılan dosya da seçili ayı böler.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {planRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {planMonthLabel} için planlanacak açık tutar yok.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hesap</TableHead>
                        <TableHead className="text-right">Vade Tanımsız</TableHead>
                        <TableHead className="text-right">Geçmiş Aylar</TableHead>
                        <TableHead className="text-right whitespace-nowrap">{plan?.labels.period1}</TableHead>
                        <TableHead className="text-right whitespace-nowrap">{plan?.labels.period2}</TableHead>
                        <TableHead className="text-right whitespace-nowrap">{plan?.labels.period3}</TableHead>
                        <TableHead className="text-right">Bu Ay Toplam</TableHead>
                        <TableHead className="text-right">Sonraki Aylar</TableHead>
                        <TableHead className="text-right">Toplam Açık</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            {row.code ? (
                              <div className="text-xs text-muted-foreground">{row.code}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.noDue > 0 ? fmtTRY(row.noDue) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-red-600">
                            {row.pastMonths > 0 ? fmtTRY(row.pastMonths) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.period1 > 0 ? fmtTRY(row.period1) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.period2 > 0 ? fmtTRY(row.period2) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.period3 > 0 ? fmtTRY(row.period3) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {row.monthTotal > 0 ? fmtTRY(row.monthTotal) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.nextMonths > 0 ? fmtTRY(row.nextMonths) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {fmtTRY(row.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Toplam satırı: dilimlerin toplamı "Toplam Açık"ı KAPATMALI. */}
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell>Toplam</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.noDue)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.pastMonths)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.period1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.period2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.period3)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.monthTotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.nextMonths)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtTRY(planTotals.total)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-xl font-bold tabular-nums", tone)}>{fmtTRY(value)}</div>
      </CardContent>
    </Card>
  )
}

function InfoCard({ label, primary, secondary }: { label: string; primary: string; secondary?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{primary}</div>
        {secondary ? <div className="text-xs text-muted-foreground">{secondary}</div> : null}
      </CardContent>
    </Card>
  )
}
