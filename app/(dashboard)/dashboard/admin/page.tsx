import { redirect } from "next/navigation"
import { getAuthContext } from "@/lib/middleware/authorization"
import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { Users, Building2, Package, FileText, TrendingUp, TrendingDown, Wallet, Settings } from "lucide-react"
import { Role } from "@prisma/client"

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

export default async function AdminDashboard() {
  const authContext = await getAuthContext()

  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }

  // Admin yetkisi kontrolü
  if (authContext.activeCompany.role !== Role.ADMIN) {
    redirect("/")
  }

  const companyId = authContext.activeCompany.companyId

  // Dashboard verileri
  const [
    customerCount,
    supplierCount,
    productCount,
    invoiceCount,
    userCount,
    incomeTotal,
    expenseTotal,
    recentInvoices,
  ] = await Promise.all([
    prisma.customer.count({ where: { companyId } }),
    prisma.supplier.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId } }),
    prisma.invoice.count({ where: { companyId } }),
    prisma.userCompany.count({ where: { companyId } }),
    prisma.transaction.aggregate({
      where: { companyId, type: "INCOME" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { companyId, type: "EXPENSE" },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { customer: true, supplier: true },
    }),
  ])

  // Aylık trend verileri
  const months = getLastSixMonths()
  const chartData = await Promise.all(
    months.map(async ({ month, start, end }) => {
      const [incomeResult, expenseResult] = await Promise.all([
        prisma.transaction.aggregate({
          where: {
            companyId,
            type: "INCOME",
            date: { gte: start, lte: end },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            companyId,
            type: "EXPENSE",
            date: { gte: start, lte: end },
          },
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
            <Settings className="h-8 w-8 text-purple-500" />
            Yönetici Paneli
          </h1>
          <p className="text-muted-foreground mt-1">
            Hoş geldiniz, {authContext.name || authContext.email}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{authContext.activeCompany.companyName}</p>
        </div>
      </div>

      {/* Ana İstatistikler */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{customerCount}</div>
            <Link href="/cari" className="text-xs text-blue-500 hover:underline">
              Yönet →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tedarikçiler</CardTitle>
            <Building2 className="h-5 w-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{supplierCount}</div>
            <Link href="/cari" className="text-xs text-purple-500 hover:underline">
              Yönet →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-orange-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ürünler</CardTitle>
            <Package className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{productCount}</div>
            <Link href="/stok" className="text-xs text-orange-500 hover:underline">
              Yönet →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Faturalar</CardTitle>
            <FileText className="h-5 w-5 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{invoiceCount}</div>
            <Link href="/e-donusum" className="text-xs text-green-500 hover:underline">
              Yönet →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow border-l-4 border-l-pink-500">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Kullanıcılar</CardTitle>
            <Users className="h-5 w-5 text-pink-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{userCount}</div>
            <span className="text-xs text-muted-foreground">Firma kullanıcıları</span>
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

      {/* Son Faturalar ve Hızlı İşlemler */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Son Faturalar</span>
              <Link href="/e-donusum" className="text-sm text-blue-500 hover:underline font-normal">
                Tümü →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentInvoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Henüz fatura yok
              </div>
            ) : (
              <div className="space-y-3">
                {recentInvoices.map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium">{invoice.invoiceNo}</p>
                      <p className="text-sm text-muted-foreground">
                        {invoice.customer?.name || invoice.supplier?.name || '-'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">
                        ₺{Number(invoice.totalAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </p>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        invoice.status === 'DRAFT' ? 'bg-yellow-100 text-yellow-700' :
                        invoice.status === 'SENT' ? 'bg-green-100 text-green-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {invoice.status === 'DRAFT' ? 'Taslak' : invoice.status === 'SENT' ? 'Gönderildi' : 'İptal'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hızlı İşlemler</CardTitle>
            <CardDescription>Yönetici işlemleri</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/cari" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Yeni Müşteri</p>
                  <p className="text-xs text-muted-foreground">Müşteri ekle</p>
                </div>
              </Link>

              <Link href="/e-donusum" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Yeni Fatura</p>
                  <p className="text-xs text-muted-foreground">Fatura oluştur</p>
                </div>
              </Link>

              <Link href="/stok" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                  <Package className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Yeni Ürün</p>
                  <p className="text-xs text-muted-foreground">Ürün ekle</p>
                </div>
              </Link>

              <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Raporlar</p>
                  <p className="text-xs text-muted-foreground">Analiz görüntüle</p>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

