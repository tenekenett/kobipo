import { redirect } from "next/navigation"
import { getAuthContext } from "@/lib/middleware/authorization"
import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { unstable_cache } from "next/cache"
import Link from "next/link"
import { format } from "date-fns"
import { tr } from "date-fns/locale"
import {
  ArrowUpRight,
  BarChart3,
  FileText,
  Package,
  Receipt,
  ScrollText,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { LockedAccount } from "@/components/dashboard/locked-account"
import { isAccountLocked } from "@/lib/modules"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { assertRouteAccessOrRedirect, pagePermissionsOfRole } from "@/lib/middleware/page-guard"
import { canAccessRoute } from "@/lib/page-access"
import { cn } from "@/lib/utils"
import { DashboardCashflowChart, type CashflowPoint } from "@/components/dashboard/dashboard-cashflow-chart"
import { dashboardTag } from "@/lib/dashboard/cache"

export const dynamic = "force-dynamic"

const DAYS_CHART = 13

function greetingForHour(h: number) {
  if (h < 12) return "Günaydın"
  if (h < 18) return "İyi günler"
  return "İyi akşamlar"
}

function invoiceStatusBadge(status: string): "aktif" | "bekliyor" | "destructive" | "secondary" {
  if (status === "SENT") return "aktif"
  if (status === "DRAFT") return "bekliyor"
  if (status === "CANCELLED") return "destructive"
  return "secondary"
}

function invoiceStatusText(status: string) {
  if (status === "SENT") return "Gönderildi"
  if (status === "DRAFT") return "Taslak"
  if (status === "CANCELLED") return "İptal"
  return status
}

function buildCashflowSeries(
  // unstable_cache JSON serileştirdiği için cache HIT'te `day` Date değil string
  // gelir; her iki durumu da new Date() ile güvenle işle.
  rows: Array<{ day: Date | string; income: unknown; expense: unknown }>,
  start: Date,
): CashflowPoint[] {
  const byDay = new Map<string, { income: number; expense: number }>()
  for (const r of rows) {
    const key = new Date(r.day).toISOString().slice(0, 10)
    byDay.set(key, { income: Number(r.income), expense: Number(r.expense) })
  }
  const out: CashflowPoint[] = []
  for (let i = 0; i <= DAYS_CHART; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    const v = byDay.get(key) ?? { income: 0, expense: 0 }
    out.push({
      label: format(d, "d MMM", { locale: tr }),
      income: v.income,
      expense: v.expense,
    })
  }
  return out
}

/**
 * Pano verisi — 20 sn önbellekli AMA firma bazlı ETİKETLİ.
 *
 * Etiket şart: satış/tahsilat yapıldığı anda panonun güncellenmesi isteniyor ve
 * 20 sn beklemek kabul edilemez. Para yazan uçlar `revalidateDashboard()` ile bu
 * etiketi düşürüyor (lib/dashboard/cache.ts). Önbellek yine de duruyor; koruduğu
 * şey art arda yenilenen panonun aynı toplamları tekrar tekrar hesaplaması.
 *
 * Neden fabrika: `tags` seçeneği `unstable_cache` KURULURKEN sabitlenir, çağrı
 * anında değil. Firma id'si etikete ancak her firma için ayrı bir örnek üreterek
 * girebiliyor. Önbellek anahtarı yine argümanlardan türüyor (firma id'si ilk
 * argüman), o yüzden firmalar birbirinin kutusunu görmez.
 */
const getDashboardDataCached = (tagCompanyId: string) => unstable_cache(
  async (companyId: string, chartStartIso: string) => {
    const chartStart = new Date(chartStartIso)
    const [statsRows, recentInvoices, cashflowRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          customer_count: bigint | number
          supplier_count: bigint | number
          product_count: bigint | number
          invoice_count: bigint | number
          draft_count: bigint | number
          sent_count: bigint | number
          quote_open_count: bigint | number
          income_total: unknown
          expense_total: unknown
        }>
      >(Prisma.sql`
        SELECT
          (SELECT COUNT(*)::INT FROM customers c WHERE c."companyId" = ${companyId}) AS customer_count,
          (SELECT COUNT(*)::INT FROM suppliers s WHERE s."companyId" = ${companyId}) AS supplier_count,
          (SELECT COUNT(*)::INT FROM products p WHERE p."companyId" = ${companyId}) AS product_count,
          (SELECT COUNT(*)::INT FROM invoices i WHERE i."companyId" = ${companyId}) AS invoice_count,
          (SELECT COUNT(*)::INT FROM invoices i WHERE i."companyId" = ${companyId} AND i.status = 'DRAFT') AS draft_count,
          (SELECT COUNT(*)::INT FROM invoices i WHERE i."companyId" = ${companyId} AND i.status = 'SENT') AS sent_count,
          (
            SELECT COUNT(*)::INT FROM quotes q
            WHERE q."companyId" = ${companyId}
              AND q.status IN ('DRAFT', 'SENT', 'APPROVED')
          ) AS quote_open_count,
          (
            SELECT COALESCE(SUM(t.amount), 0)
            FROM transactions t
            WHERE t."companyId" = ${companyId}
              AND t.type = 'INCOME'
          ) AS income_total,
          (
            SELECT COALESCE(SUM(t.amount), 0)
            FROM transactions t
            WHERE t."companyId" = ${companyId}
              AND t.type = 'EXPENSE'
          ) AS expense_total
      `),
      prisma.invoice.findMany({
        where: { companyId },
        orderBy: { date: "desc" },
        take: 6,
        select: {
          id: true,
          invoiceNo: true,
          status: true,
          date: true,
          totalAmount: true,
          type: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      }),
      prisma.$queryRaw<Array<{ day: Date; income: unknown; expense: unknown }>>`
        SELECT
          (DATE_TRUNC('day', "date"))::date AS day,
          COALESCE(SUM(CASE WHEN "type" = 'INCOME' THEN "amount" ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN "type" = 'EXPENSE' THEN "amount" ELSE 0 END), 0) AS expense
        FROM transactions
        WHERE "companyId" = ${companyId}
          AND "date" >= ${chartStart}
        GROUP BY 1
        ORDER BY 1
      `,
    ])

    return { statsRows, recentInvoices, cashflowRows }
  },
  ["dashboard-data-v2"],
  { revalidate: 20, tags: [dashboardTag(tagCompanyId)] }
)

export default async function DashboardIndexPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const authContext = await getAuthContext()

  if (!authContext) {
    redirect("/signin")
  }

  if (authContext.companies.length === 0) {
    // Firması olmayan SÜPER-ADMİN, firma kurulum formuna değil kendi paneline gider.
    // Platform yöneticisi hesabının firma üyeliği yoktur; onu "ilk firmanı oluştur"
    // ekranına düşürmek, üstelik VIEWER rolüyle, paneli erişilemez gösteriyordu
    // (o ekrandan sistem yönetimine bağlantı yok).
    redirect(authContext.isSuperAdmin ? "/system-admin" : "/companies/new")
  }

  const query = (await searchParams) || {}
  const requestedCompanyId = typeof query.company === "string" ? query.company : undefined
  const selectedCompany =
    authContext.companies.find((company) => company.companyId === requestedCompanyId || company.companySlug === requestedCompanyId) ||
    authContext.activeCompany ||
    authContext.companies[0]

  const companyId = selectedCompany.companyId
  const companyQuery = `?company=${companyId}`

  // Kısıtlı çalışan panoyu göremez: pano ciro/kâr basıyor ve veriyi server component
  // çektiği için istemci guard'ı geç kalır (bkz. lib/middleware/page-guard.ts).
  assertRouteAccessOrRedirect(selectedCompany, "/dashboard", requestedCompanyId)

  // Panonun GÖVDESİ de kenar çubuğuyla aynı listeden süzülür. Kenar çubuğu
  // (`useVisiblePages`) kapalı sayfaları hiç çizmiyordu ama buradaki kutucuklar ve
  // fatura linkleri herkese aynı çiziliyordu: pano Gözlemci'nin AÇILIŞ sayfası, yani
  // gördüğü her bağlantı onu sayfa kapısına çarpıp aynı panoya geri atıyordu.
  const permissions = pagePermissionsOfRole(selectedCompany)
  const canOpen = (path: string) => canAccessRoute(permissions, path)
  // Fatura listesi ve fatura önizlemesi aynı sahibe bağlıdır (`/satis/fatura`,
  // `/alis/fatura`); tek soru ikisini birden yanıtlar.
  const canOpenInvoices = canOpen("/faturalar")

  // Hiçbir ÜCRETLİ modülü olmayan hesap: rakam yerine satın alma ekranı. Sorgular da
  // atlanır — kilitli hesapta hepsi sıfır döner, çalıştırmanın anlamı yok. Temel
  // (ücretsiz) modüller ölçüye girmez; girseydi kilit ekranı hiç görünmezdi.
  const freeModules = await getFreeModuleKeys()
  if (isAccountLocked(selectedCompany.disabledModules, freeModules)) {
    return (
      <LockedAccount
        companyId={companyId}
        canPurchase={selectedCompany.role === "ADMIN"}
        freeModules={freeModules}
        isArchived={selectedCompany.isArchived}
      />
    )
  }

  const chartStart = new Date()
  chartStart.setHours(0, 0, 0, 0)
  chartStart.setDate(chartStart.getDate() - DAYS_CHART)

  const { statsRows, recentInvoices, cashflowRows } = await getDashboardDataCached(companyId)(
    companyId,
    chartStart.toISOString()
  )

  const stats = statsRows[0]
  const customerCount = Number(stats?.customer_count || 0)
  const supplierCount = Number(stats?.supplier_count || 0)
  const productCount = Number(stats?.product_count || 0)
  const invoiceCount = Number(stats?.invoice_count || 0)
  const draftCount = Number(stats?.draft_count || 0)
  const sentCount = Number(stats?.sent_count || 0)
  const quoteOpenCount = Number(stats?.quote_open_count || 0)
  const income = Number(stats?.income_total || 0)
  const expense = Number(stats?.expense_total || 0)
  const balance = income - expense
  const flowTotal = income + expense
  const incomeSharePct = flowTotal > 0 ? Math.round((income / flowTotal) * 100) : 0

  const chartData = buildCashflowSeries(cashflowRows, chartStart)

  const now = new Date()
  const hour = now.getHours()
  const greeting = greetingForHour(hour)
  const dateLine = format(now, "EEEE, d MMMM yyyy", { locale: tr })

  // Kutucuklar da süzülür: kapalı bir sayfaya götüren kutucuk çizilmez.
  const quickTiles = [
    {
      path: "/cari",
      label: "Cari hesaplar",
      sub: "Müşteri ve tedarikçi",
      icon: Users,
      tint: "from-kobipo-blue/15 to-kobipo-mid/10",
      ring: "ring-kobipo-blue/20",
    },
    {
      path: "/stok",
      label: "Stok",
      sub: "Ürün ve hareket",
      icon: Package,
      tint: "from-kobipo-green/20 to-kobipo-green-dark/10",
      ring: "ring-kobipo-green/25",
    },
    {
      path: "/satis/fatura",
      label: "Faturalar",
      sub: "Liste ve düzenleme",
      icon: Receipt,
      tint: "from-amber-100/80 to-orange-50/60",
      ring: "ring-amber-200/60",
    },
    {
      path: "/finans",
      label: "Finans",
      sub: "Hesap ve işlemler",
      icon: Wallet,
      tint: "from-slate-100 to-kobipo-pale",
      ring: "ring-slate-200/80",
    },
    {
      path: "/teklif",
      label: "Teklifler",
      sub: "Açık teklifler",
      icon: ScrollText,
      tint: "from-violet-100/70 to-indigo-50/50",
      ring: "ring-violet-200/50",
    },
    {
      path: "/raporlar",
      label: "Raporlar",
      sub: "Bilanço ve özet",
      icon: BarChart3,
      tint: "from-kobipo-light/90 to-kobipo-pale",
      ring: "ring-kobipo-mid/20",
    },
  ].filter((tile) => canOpen(tile.path))

  return (
    <div className="space-y-8 pb-8">
      {/* Hero */}
      <section
        className={cn(
          "relative isolate overflow-hidden rounded-3xl border border-kobipo-border/90",
          "bg-gradient-to-br from-card via-card to-kobipo-pale/50 p-8 shadow-[0_20px_60px_-24px_rgba(12,59,107,0.18)] dark:shadow-[0_20px_60px_-24px_rgba(0,0,0,0.6)] md:p-10",
        )}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-gradient-to-br from-kobipo-mid/25 to-kobipo-blue/5 blur-3xl animate-dash-shimmer"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-kobipo-green/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl animate-fade-up">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-kobipo-blue">
              <Sparkles className="h-4 w-4" aria-hidden />
              {greeting}
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-kobipo-navy dark:text-foreground md:text-4xl lg:text-[2.35rem] lg:leading-tight">
              Bugün işletmenizde neler oluyor?
            </h1>
            <p className="mt-2 text-sm font-medium capitalize text-kobipo-gray md:text-base">{dateLine}</p>
            <p className="mt-4 text-base leading-relaxed text-kobipo-gray md:text-lg">
              <span className="font-semibold text-kobipo-text">{selectedCompany.companyName}</span> için genel özet
              paneli — cariden faturaya, nakit akışından taslak uyarılarına kadar tek ekranda.
            </p>
          </div>

          <div
            className={cn(
              "relative w-full max-w-sm shrink-0 rounded-2xl border border-white/60 bg-white/70 p-5 shadow-card backdrop-blur-md",
              "dark:border-border dark:bg-card/70",
              "animate-fade-up [animation-delay:90ms]",
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">Net bakiye (tüm zamanlar)</p>
            <p
              className={cn(
                "mt-1 font-mono text-3xl font-bold tracking-tight md:text-[2rem]",
                balance >= 0 ? "text-kobipo-navy dark:text-foreground" : "text-orange-700",
              )}
            >
              ₺{balance.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-kobipo-green-light/50 px-3 py-2 dark:bg-emerald-950/40">
                <p className="font-medium text-kobipo-green-dark dark:text-emerald-300">Gelir</p>
                <p className="font-mono text-sm font-semibold text-kobipo-navy dark:text-foreground">
                  ₺{income.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="rounded-xl bg-red-50/80 px-3 py-2 dark:bg-red-950/40">
                <p className="font-medium text-red-800/90 dark:text-red-300">Gider</p>
                <p className="font-mono text-sm font-semibold text-kobipo-navy dark:text-foreground">
                  ₺{expense.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                </p>
              </div>
            </div>
            {flowTotal > 0 && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-[11px] font-medium text-kobipo-gray">
                  <span>Gelir payı</span>
                  <span className="text-kobipo-navy dark:text-foreground">{incomeSharePct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-kobipo-border">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-kobipo-blue to-kobipo-mid transition-all"
                    style={{ width: `${incomeSharePct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Müşteri",
            value: customerCount,
            icon: Users,
            accent: "text-kobipo-blue",
            bg: "bg-kobipo-pale",
            delay: "0ms",
          },
          {
            label: "Tedarikçi",
            value: supplierCount,
            icon: TrendingUp,
            accent: "text-kobipo-mid",
            bg: "bg-kobipo-light/40",
            delay: "45ms",
          },
          {
            label: "Ürün",
            value: productCount,
            icon: Package,
            accent: "text-kobipo-green-dark",
            bg: "bg-kobipo-green-light/50",
            delay: "90ms",
          },
          {
            label: "Fatura",
            value: invoiceCount,
            icon: FileText,
            accent: "text-kobipo-navy dark:text-foreground",
            bg: "bg-slate-100/80",
            delay: "135ms",
          },
        ].map((k) => (
          <div
            key={k.label}
            className={cn(
              "group relative overflow-hidden rounded-2xl border border-kobipo-border/80 bg-card p-5 shadow-card",
              "transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-16px_rgba(12,59,107,0.15)]",
              "animate-fade-up",
            )}
            style={{ animationDelay: k.delay }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">{k.label}</p>
                <p className="mt-2 font-mono text-3xl font-extrabold tabular-nums text-kobipo-navy dark:text-foreground">{k.value}</p>
              </div>
              <span className={cn("rounded-xl p-2.5", k.bg, k.accent)}>
                <k.icon className="h-5 w-5" aria-hidden />
              </span>
            </div>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-kobipo-mid/25 to-transparent opacity-0 transition group-hover:opacity-100"
              aria-hidden
            />
          </div>
        ))}
      </section>

      {/* Bento: chart + status */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div
          className="lg:col-span-8 animate-fade-up rounded-3xl border border-kobipo-border/90 bg-card p-6 shadow-card [animation-delay:120ms]"
        >
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-kobipo-border/60 pb-4">
            <div>
              <h2 className="text-lg font-bold text-kobipo-navy dark:text-foreground">Nakit akışı</h2>
              <p className="text-sm text-kobipo-gray">Son 14 gün — gelir ve gider (işlem tarihine göre)</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5 text-kobipo-blue">
                <span className="h-2 w-2 rounded-full bg-kobipo-blue" />
                Gelir
              </span>
              <span className="flex items-center gap-1.5 text-red-600">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Gider
              </span>
            </div>
          </div>
          <div className="pt-4">
            <DashboardCashflowChart data={chartData} />
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <div
            className={cn(
              "flex flex-1 flex-col justify-between rounded-3xl border p-6 shadow-card animate-fade-up [animation-delay:160ms]",
              draftCount > 0
                ? "border-amber-200/90 bg-gradient-to-br from-amber-50/90 to-card dark:border-amber-900/40 dark:from-amber-950/40"
                : "border-kobipo-border/90 bg-gradient-to-br from-kobipo-pale/40 to-card",
            )}
          >
            <div>
              <h2 className="text-lg font-bold text-kobipo-navy dark:text-foreground">Operasyon</h2>
              <p className="mt-1 text-sm text-kobipo-gray">Fatura ve teklif durumu</p>
            </div>
            <ul className="mt-6 space-y-4">
              <li className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-kobipo-text">Gönderilmiş fatura</span>
                <span className="font-mono text-lg font-bold text-kobipo-navy dark:text-foreground">{sentCount}</span>
              </li>
              <li className="flex items-center justify-between gap-3 border-t border-kobipo-border/50 pt-4">
                <span className="text-sm font-medium text-kobipo-text">Taslak fatura</span>
                <span
                  className={cn(
                    "font-mono text-lg font-bold",
                    draftCount > 0 ? "text-amber-700" : "text-kobipo-gray",
                  )}
                >
                  {draftCount}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 border-t border-kobipo-border/50 pt-4">
                <span className="text-sm font-medium text-kobipo-text">Açık teklif</span>
                <span className="font-mono text-lg font-bold text-kobipo-navy dark:text-foreground">{quoteOpenCount}</span>
              </li>
            </ul>
            {draftCount > 0 && canOpenInvoices && (
              <Link
                href={`/satis/fatura${companyQuery}`}
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-kobipo-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-kobipo-blue dark:bg-kobipo-blue dark:hover:bg-kobipo-mid"
              >
                Taslaklara git
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </div>

          <div
            className={cn(
              "rounded-3xl border border-kobipo-border/90 bg-card p-6 shadow-card animate-fade-up [animation-delay:200ms]",
              "flex items-center gap-4",
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-kobipo-pale text-kobipo-blue">
              {balance >= 0 ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6 text-orange-600" />}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">Özet</p>
              <p className="mt-0.5 text-sm leading-snug text-kobipo-text">
                {balance >= 0
                  ? "Kayıtlı gelirleriniz giderlerinizi aşıyor; tabloyu raporlardan detaylandırabilirsiniz."
                  : "Gider tarafı geliri geçmiş görünüyor; finans ve cari ekranlarından hareketleri gözden geçirin."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Recent invoices + quick tiles */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 animate-fade-up rounded-3xl border border-kobipo-border/90 bg-card shadow-card [animation-delay:220ms]">
          <div className="flex items-center justify-between border-b border-kobipo-border/60 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-kobipo-navy dark:text-foreground">Son faturalar</h2>
              <p className="text-sm text-kobipo-gray">En güncel altı kayıt</p>
            </div>
            {canOpenInvoices && (
              <Link
                href={`/satis/fatura${companyQuery}`}
                className="inline-flex items-center gap-1 text-sm font-semibold text-kobipo-blue hover:underline"
              >
                Tümü
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            )}
          </div>
          <div className="divide-y divide-kobipo-border/60">
            {recentInvoices.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-kobipo-gray">Henüz fatura yok.</p>
            ) : (
              recentInvoices.map((inv) => {
                const counterparty =
                  inv.type === "PURCHASE"
                    ? inv.supplier?.name ?? "—"
                    : inv.customer?.name ?? "—"
                const rowClass = cn(
                  "flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between",
                  canOpenInvoices && "transition hover:bg-kobipo-offwhite/80 dark:hover:bg-muted/40",
                )
                const row = (
                  <>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-kobipo-navy dark:text-foreground">{inv.invoiceNo}</span>
                        <Badge variant={invoiceStatusBadge(inv.status)}>{invoiceStatusText(inv.status)}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm text-kobipo-gray">
                        {counterparty}
                        <span className="text-kobipo-border"> · </span>
                        {format(inv.date, "d MMM yyyy", { locale: tr })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-kobipo-navy dark:text-foreground">
                        ₺{Number(inv.totalAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                      </span>
                      {canOpenInvoices ? (
                        <ArrowUpRight className="h-4 w-4 text-kobipo-gray opacity-60" aria-hidden />
                      ) : null}
                    </div>
                  </>
                )
                // Fatura ekranını göremeyen kullanıcıda satır LİNK DEĞİL: rakamı okur,
                // tıklayınca sayfa kapısına çarpıp panoya geri atılmaz. Liste kalır —
                // panoyu görmeye yetkisi olan bu özeti de görür.
                return canOpenInvoices ? (
                  <Link
                    key={inv.id}
                    href={`/faturalar/${inv.id}/onizleme${companyQuery}`}
                    className={rowClass}
                  >
                    {row}
                  </Link>
                ) : (
                  <div key={inv.id} className={rowClass}>
                    {row}
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className={cn("lg:col-span-5", quickTiles.length === 0 && "hidden")}>
          <h2 className="mb-3 text-lg font-bold text-kobipo-navy dark:text-foreground animate-fade-up [animation-delay:240ms]">
            Hızlı erişim
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {quickTiles.map((tile, i) => (
              <Link
                key={tile.path}
                href={`${tile.path}${companyQuery}`}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border border-kobipo-border/80 bg-card p-4 shadow-card",
                  "transition duration-200 hover:-translate-y-0.5 hover:border-kobipo-mid/30 hover:shadow-lg",
                  "animate-fade-up",
                )}
                style={{ animationDelay: `${260 + i * 40}ms` }}
              >
                <div
                  className={cn(
                    "mb-3 inline-flex rounded-xl bg-gradient-to-br p-2.5 ring-1",
                    tile.tint,
                    tile.ring,
                  )}
                >
                  <tile.icon className="h-5 w-5 text-kobipo-navy dark:text-foreground" aria-hidden />
                </div>
                <p className="font-semibold text-kobipo-navy dark:text-foreground">{tile.label}</p>
                <p className="mt-0.5 text-xs text-kobipo-gray">{tile.sub}</p>
                <ArrowUpRight className="absolute right-3 top-3 h-4 w-4 text-kobipo-gray opacity-0 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
