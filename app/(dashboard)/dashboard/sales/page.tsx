import { Suspense } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import {
  FileText,
  Package,
  Receipt,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"
import { Role } from "@prisma/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getAuthContext } from "@/lib/middleware/authorization"
import {
  RecentInvoicesSkeleton,
  StatsSkeleton,
} from "@/components/dashboard/admin/skeletons"
import {
  getRecentSalesInvoices,
  getSalesStats,
  getTopCustomers,
} from "@/lib/dashboard/role-queries"

export const dynamic = "force-dynamic"

async function SalesStatsCards({ companyId }: { companyId: string }) {
  const stats = await getSalesStats(companyId)
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Aylık Satış</CardTitle>
          <TrendingUp className="h-5 w-5 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            ₺{stats.monthlySalesTotal.toLocaleString("tr-TR")}
          </div>
          <span className="text-xs text-muted-foreground">Son 30 gün</span>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
          <Users className="h-5 w-5 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.customerCount}</div>
          <Link href="/cari" className="text-xs text-blue-500 hover:underline">
            Müşteri listesi →
          </Link>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Ürünler</CardTitle>
          <Package className="h-5 w-5 text-orange-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.productCount}</div>
          <Link href="/stok" className="text-xs text-orange-500 hover:underline">
            Ürün kataloğu →
          </Link>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-kobipo-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Aylık Fatura</CardTitle>
          <FileText className="h-5 w-5 text-purple-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.monthlyInvoices}</div>
          <span className="text-xs text-muted-foreground">Son 30 gün</span>
        </CardContent>
      </Card>
    </div>
  )
}

async function RecentSalesInvoicesCard({ companyId }: { companyId: string }) {
  const recentInvoices = await getRecentSalesInvoices(companyId, 5)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-green-500" />
            Son Satış Faturaları
          </span>
          <Link href="/e-donusum" className="text-sm text-green-500 hover:underline font-normal">
            Tümü →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recentInvoices.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Henüz satış faturası yok
          </div>
        ) : (
          <div className="space-y-3">
            {recentInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div>
                  <p className="font-medium">{invoice.invoiceNo}</p>
                  <p className="text-sm text-muted-foreground">
                    {invoice.customer?.name || "Müşteri belirtilmemiş"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-green-600">
                    ₺{Number(invoice.totalAmount).toLocaleString("tr-TR")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(invoice.createdAt).toLocaleDateString("tr-TR")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

async function TopCustomersCard({ companyId }: { companyId: string }) {
  const topCustomers = await getTopCustomers(companyId, 5)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-blue-500" />
          En İyi Müşteriler
        </CardTitle>
        <CardDescription>Toplam satış tutarına göre</CardDescription>
      </CardHeader>
      <CardContent>
        {topCustomers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Henüz müşteri verisi yok</div>
        ) : (
          <div className="space-y-3">
            {topCustomers.map((tc, index) => (
              <div
                key={tc.customerId}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${
                      index === 0
                        ? "bg-yellow-500"
                        : index === 1
                        ? "bg-gray-400"
                        : index === 2
                        ? "bg-orange-600"
                        : "bg-slate-500"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-medium">{tc.customerName}</p>
                    <p className="text-xs text-muted-foreground">{tc.invoiceCount} fatura</p>
                  </div>
                </div>
                <p className="font-medium text-green-600">
                  ₺{tc.totalAmount.toLocaleString("tr-TR")}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default async function SalesDashboard() {
  const authContext = await getAuthContext()
  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }
  const allowedRoles: Role[] = [Role.SALES, Role.ADMIN]
  if (!allowedRoles.includes(authContext.activeCompany.role)) {
    redirect("/")
  }
  const companyId = authContext.activeCompany.companyId

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3 text-kobipo-navy dark:text-foreground">
            <ShoppingCart className="h-8 w-8 text-green-500" />
            Satış Paneli
          </h1>
          <p className="mt-1 text-kobipo-gray">Satış performansı ve müşteri ilişkileri</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{authContext.activeCompany.companyName}</p>
        </div>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        <SalesStatsCards companyId={companyId} />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<RecentInvoicesSkeleton />}>
          <RecentSalesInvoicesCard companyId={companyId} />
        </Suspense>
        <Suspense fallback={<RecentInvoicesSkeleton />}>
          <TopCustomersCard companyId={companyId} />
        </Suspense>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hızlı İşlemler</CardTitle>
          <CardDescription>Satış işlemleri</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link href="/e-donusum" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <FileText className="w-8 h-8 text-green-500" />
              <div>
                <p className="font-medium text-sm">Yeni Satış</p>
                <p className="text-xs text-muted-foreground">Fatura oluştur</p>
              </div>
            </Link>
            <Link href="/cari" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <Users className="w-8 h-8 text-blue-500" />
              <div>
                <p className="font-medium text-sm">Yeni Müşteri</p>
                <p className="text-xs text-muted-foreground">Müşteri ekle</p>
              </div>
            </Link>
            <Link href="/stok" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <Package className="w-8 h-8 text-orange-500" />
              <div>
                <p className="font-medium text-sm">Stok Kontrol</p>
                <p className="text-xs text-muted-foreground">Stok durumu</p>
              </div>
            </Link>
            <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
              <TrendingUp className="w-8 h-8 text-purple-500" />
              <div>
                <p className="font-medium text-sm">Satış Raporu</p>
                <p className="text-xs text-muted-foreground">Analiz görüntüle</p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
