import { Suspense } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import {
  Calculator,
  CreditCard,
  FileText,
  Receipt,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react"
import { Role } from "@prisma/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getAuthContext, resolveActiveCompany } from "@/lib/middleware/authorization"
import { roleToDashboardPath } from "@/lib/auth/role-paths"
import { withCompanyHref } from "@/lib/company/href"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import {
  CashflowChartSkeleton,
  CashflowSummarySkeleton,
  RecentInvoicesSkeleton,
  StatsSkeleton,
} from "@/components/dashboard/admin/skeletons"
import { getMonthlyCashflow } from "@/lib/dashboard/admin-queries"
import { getAccountantStats, getRecentTransactions } from "@/lib/dashboard/role-queries"
import { LockedAccount } from "@/components/dashboard/locked-account"
import { isAccountLocked } from "@/lib/modules"

export const dynamic = "force-dynamic"

async function AccountantStatsCards({ companyId }: { companyId: string }) {
  const stats = await getAccountantStats(companyId)
  const href = (path: string) => withCompanyHref(path, companyId)
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
          <Users className="h-5 w-5 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.customerCount}</div>
          <Link href={href("/cari")} className="text-xs text-blue-500 hover:underline">
            Cari hesaplar →
          </Link>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Tedarikçiler</CardTitle>
          <CreditCard className="h-5 w-5 text-purple-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.supplierCount}</div>
          <Link href={href("/cari")} className="text-xs text-purple-500 hover:underline">
            Cari hesaplar →
          </Link>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Fatura</CardTitle>
          <FileText className="h-5 w-5 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.invoiceCount}</div>
          <Link href={href("/e-donusum")} className="text-xs text-green-500 hover:underline">
            Faturalar →
          </Link>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Bekleyen Fatura</CardTitle>
          <Receipt className="h-5 w-5 text-yellow-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.pendingInvoices}</div>
          <span className="text-xs text-muted-foreground">Taslak faturalar</span>
        </CardContent>
      </Card>
    </div>
  )
}

async function AccountantCashflow({ companyId }: { companyId: string }) {
  const [stats, chartData] = await Promise.all([
    getAccountantStats(companyId),
    getMonthlyCashflow(companyId, 6),
  ])
  const balance = stats.income - stats.expense
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Toplam Gelir
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700 dark:text-green-400">
              ₺{stats.income.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border-red-200 dark:border-red-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-700 dark:text-red-400 flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Toplam Gider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700 dark:text-red-400">
              ₺{stats.expense.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card
          className={`bg-gradient-to-br ${
            balance >= 0
              ? "from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-800"
              : "from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-800"
          }`}
        >
          <CardHeader className="pb-2">
            <CardTitle
              className={`text-sm font-medium flex items-center gap-2 ${
                balance >= 0
                  ? "text-blue-700 dark:text-blue-400"
                  : "text-orange-700 dark:text-orange-400"
              }`}
            >
              <Wallet className="h-4 w-4" />
              Net Bakiye
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                balance >= 0
                  ? "text-blue-700 dark:text-blue-400"
                  : "text-orange-700 dark:text-orange-400"
              }`}
            >
              ₺{balance.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
      </div>
      <RevenueChart data={chartData} />
    </div>
  )
}

async function RecentTransactionsCard({ companyId }: { companyId: string }) {
  const recentTransactions = await getRecentTransactions(companyId, 10)
  const href = (path: string) => withCompanyHref(path, companyId)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Son İşlemler</span>
          <Link href={href("/finans")} className="text-sm text-blue-500 hover:underline font-normal">
            Tümü →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recentTransactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Henüz işlem yok</div>
        ) : (
          <div className="space-y-2">
            {recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      tx.type === "INCOME" ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <div>
                    <p className="font-medium text-sm">{tx.description || tx.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {tx.customer?.name || tx.supplier?.name || tx.account?.name}
                    </p>
                  </div>
                </div>
                <span className={`font-medium ${tx.type === "INCOME" ? "text-green-600" : "text-red-600"}`}>
                  {tx.type === "INCOME" ? "+" : "-"}₺{Number(tx.amount).toLocaleString("tr-TR")}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function QuickActions({ companyId }: { companyId: string }) {
  const href = (path: string) => withCompanyHref(path, companyId)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hızlı İşlemler</CardTitle>
        <CardDescription>Muhasebe işlemleri</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <Link href={href("/e-donusum")} className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
            <FileText className="w-8 h-8 text-green-500" />
            <div>
              <p className="font-medium text-sm">Yeni Fatura</p>
              <p className="text-xs text-muted-foreground">Fatura oluştur</p>
            </div>
          </Link>
          <Link href={href("/cari/ekstre")} className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
            <Receipt className="w-8 h-8 text-blue-500" />
            <div>
              <p className="font-medium text-sm">Cari Ekstre</p>
              <p className="text-xs text-muted-foreground">Ekstre görüntüle</p>
            </div>
          </Link>
          <Link href={href("/finans")} className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
            <Wallet className="w-8 h-8 text-purple-500" />
            <div>
              <p className="font-medium text-sm">Finans</p>
              <p className="text-xs text-muted-foreground">Hesap hareketleri</p>
            </div>
          </Link>
          <Link href={href("/raporlar")} className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
            <TrendingUp className="w-8 h-8 text-orange-500" />
            <div>
              <p className="font-medium text-sm">KDV Raporu</p>
              <p className="text-xs text-muted-foreground">KDV hesapla</p>
            </div>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function AccountantDashboard({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[] }>
}) {
  const authContext = await getAuthContext()
  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }
  const sp = await searchParams
  const requested = typeof sp.company === "string" ? sp.company : undefined
  const activeCompany = resolveActiveCompany(authContext, requested) ?? authContext.activeCompany
  const allowedRoles: Role[] = [Role.ACCOUNTANT, Role.ADMIN]
  if (!allowedRoles.includes(activeCompany.role)) {
    // `/` panel değil pazarlama sayfasıdır (app/page.tsx); rolün kendi paneline gönder.
    redirect(withCompanyHref(roleToDashboardPath(activeCompany.role), activeCompany.companySlug))
  }
  // Hiç modülü açık olmayan hesap: rakam yerine satın alma ekranı. Giriş sonrası
  // kullanıcı rolüne göre bu sayfalardan birine düşüyor, o yüzden kontrol her rol
  // panelinde ayrı ayrı durmalı — yalnız /dashboard'da olması yetmiyor.
  if (isAccountLocked(activeCompany.disabledModules)) {
    return (
      <LockedAccount
        companyId={activeCompany.companySlug ?? activeCompany.companyId}
        canPurchase={activeCompany.role === "ADMIN"}
      />
    )
  }

  const companyId = activeCompany.companyId

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3 text-kobipo-navy dark:text-foreground">
            <Calculator className="h-8 w-8 text-blue-500" />
            Muhasebe Paneli
          </h1>
          <p className="mt-1 text-kobipo-gray">Finansal özet ve işlemler</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{activeCompany.companyName}</p>
        </div>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        <AccountantStatsCards companyId={companyId} />
      </Suspense>

      <Suspense
        fallback={
          <div className="space-y-4">
            <CashflowSummarySkeleton />
            <CashflowChartSkeleton />
          </div>
        }
      >
        <AccountantCashflow companyId={companyId} />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<RecentInvoicesSkeleton />}>
          <RecentTransactionsCard companyId={companyId} />
        </Suspense>
        <QuickActions companyId={companyId} />
      </div>
    </div>
  )
}
