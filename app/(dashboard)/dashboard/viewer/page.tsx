import { redirect } from "next/navigation"
import { getAuthContext } from "@/lib/middleware/authorization"
import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { Eye, Users, Package, FileText, TrendingUp, TrendingDown, Wallet, BarChart3 } from "lucide-react"

export const dynamic = "force-dynamic"

function getLastSixMonths() {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      month: date.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" }),
      start: new Date(date.getFullYear(), date.getMonth(), 1),
      end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59),
    })
  }
  return months
}

export default async function ViewerDashboard() {
  const authContext = await getAuthContext()

  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }

  const companyId = authContext.activeCompany.companyId

  // Dashboard verileri (sadece okuma)
  const [
    customerCount,
    supplierCount,
    productCount,
    invoiceCount,
    incomeTotal,
    expenseTotal,
  ] = await Promise.all([
    prisma.customer.count({ where: { companyId } }),
    prisma.supplier.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId } }),
    prisma.invoice.count({ where: { companyId } }),
    prisma.transaction.aggregate({
      where: { companyId, type: "INCOME" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { companyId, type: "EXPENSE" },
      _sum: { amount: true },
    }),
  ])

  // Aylık trend verileri
  const months = getLastSixMonths()
  const chartData = await Promise.all(
    months.map(async ({ month, start, end }) => {
      const [incomeResult, expenseResult] = await Promise.all([
        prisma.transaction.aggregate({
          where: { companyId, type: "INCOME", date: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { companyId, type: "EXPENSE", date: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
      ])
      return {
        month,
        income: Number(incomeResult._sum.amount || 0),
        expense: Number(expenseResult._sum.amount || 0),
      }
    })
  )

  const income = Number(incomeTotal._sum.amount || 0)
  const expense = Number(expenseTotal._sum.amount || 0)
  const balance = income - expense

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Eye className="h-8 w-8 text-slate-500" />
            Görüntüleme Paneli
          </h1>
          <p className="text-muted-foreground mt-1">
            Firma istatistikleri ve raporlar (salt okunur)
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{authContext.activeCompany.companyName}</p>
        </div>
      </div>

      {/* Bilgi Notu */}
      <Card className="bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 text-slate-500" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Bu panelde sadece görüntüleme yetkisine sahipsiniz. Veri ekleme, düzenleme veya silme işlemleri yapılamaz.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Ana İstatistikler */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{customerCount}</div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tedarikçiler</CardTitle>
            <Users className="h-5 w-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{supplierCount}</div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ürünler</CardTitle>
            <Package className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{productCount}</div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Faturalar</CardTitle>
            <FileText className="h-5 w-5 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{invoiceCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Finansal Özet */}
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
              ₺{income.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
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
              ₺{expense.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card className={`bg-gradient-to-br ${balance >= 0 ? 'from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-800' : 'from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-800'}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm font-medium flex items-center gap-2 ${balance >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'}`}>
              <Wallet className="h-4 w-4" />
              Net Bakiye
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${balance >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'}`}>
              ₺{balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grafik */}
      <RevenueChart data={chartData} />

      {/* Raporlara Hızlı Erişim */}
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

