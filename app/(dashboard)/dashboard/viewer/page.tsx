import { Suspense } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import { BarChart3, Eye, FileText, Package, TrendingUp, Users } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getAuthContext } from "@/lib/middleware/authorization"
import { DashboardCashflow } from "@/components/dashboard/admin/dashboard-cashflow"
import {
  CashflowChartSkeleton,
  CashflowSummarySkeleton,
  StatsSkeleton,
} from "@/components/dashboard/admin/skeletons"
import { getAdminStats } from "@/lib/dashboard/admin-queries"

export const dynamic = "force-dynamic"

async function ViewerStats({ companyId }: { companyId: string }) {
  const stats = await getAdminStats(companyId)
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
          <Users className="h-5 w-5 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.customerCount}</div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Tedarikçiler</CardTitle>
          <Users className="h-5 w-5 text-purple-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.supplierCount}</div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Ürünler</CardTitle>
          <Package className="h-5 w-5 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.productCount}</div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Faturalar</CardTitle>
          <FileText className="h-5 w-5 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.invoiceCount}</div>
        </CardContent>
      </Card>
    </div>
  )
}

export default async function ViewerDashboard() {
  const authContext = await getAuthContext()
  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }
  const companyId = authContext.activeCompany.companyId

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3 text-kobipo-navy">
            <Eye className="h-8 w-8 text-slate-500" />
            Görüntüleme Paneli
          </h1>
          <p className="mt-1 text-kobipo-gray">Firma istatistikleri ve raporlar (salt okunur)</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{authContext.activeCompany.companyName}</p>
        </div>
      </div>

      <Card className="rounded-2xl border border-kobipo-border bg-kobipo-pale/50 shadow-card">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 text-slate-500" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Bu panelde sadece görüntüleme yetkisine sahipsiniz. Veri ekleme, düzenleme veya silme
              işlemleri yapılamaz.
            </p>
          </div>
        </CardContent>
      </Card>

      <Suspense fallback={<StatsSkeleton />}>
        <ViewerStats companyId={companyId} />
      </Suspense>

      <Suspense
        fallback={
          <div className="space-y-4">
            <CashflowSummarySkeleton />
            <CashflowChartSkeleton />
          </div>
        }
      >
        <DashboardCashflow companyId={companyId} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-500" />
            Raporlar
          </CardTitle>
          <CardDescription>Görüntüleyebileceğiniz raporlar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <TrendingUp className="w-8 h-8 text-green-500" />
              <div>
                <p className="font-medium text-sm">Gelir/Gider</p>
                <p className="text-xs text-muted-foreground">Finansal analiz</p>
              </div>
            </Link>
            <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <FileText className="w-8 h-8 text-blue-500" />
              <div>
                <p className="font-medium text-sm">KDV Raporu</p>
                <p className="text-xs text-muted-foreground">Vergi özeti</p>
              </div>
            </Link>
            <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <Package className="w-8 h-8 text-orange-500" />
              <div>
                <p className="font-medium text-sm">Stok Raporu</p>
                <p className="text-xs text-muted-foreground">Stok durumu</p>
              </div>
            </Link>
            <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <Users className="w-8 h-8 text-purple-500" />
              <div>
                <p className="font-medium text-sm">Cari Rapor</p>
                <p className="text-xs text-muted-foreground">Bakiye özeti</p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
