import { redirect } from "next/navigation"
import { getAuthContext } from "@/lib/middleware/authorization"
import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { Calculator, FileText, TrendingUp, TrendingDown, Wallet, Receipt, Users, CreditCard } from "lucide-react"
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

export default async function AccountantDashboard() {
  const authContext = await getAuthContext()

  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }

  // Muhasebeci veya Admin yetkisi kontrolü
  const allowedRoles: Role[] = [Role.ACCOUNTANT, Role.ADMIN]
  if (!allowedRoles.includes(authContext.activeCompany.role)) {
    redirect("/")
  }

  const companyId = authContext.activeCompany.companyId

  // Dashboard verileri
  const [
    customerCount,
    supplierCount,
    invoiceCount,
    pendingInvoices,
    incomeTotal,
    expenseTotal,
    recentTransactions,
  ] = await Promise.all([
    prisma.customer.count({ where: { companyId } }),
    prisma.supplier.count({ where: { companyId } }),
    prisma.invoice.count({ where: { companyId } }),
    prisma.invoice.count({ where: { companyId, status: "DRAFT" } }),
    prisma.transaction.aggregate({
      where: { companyId, type: "INCOME" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { companyId, type: "EXPENSE" },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { customer: true, supplier: true, account: true },
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
          <h1 className="text-3xl font-extrabold flex items-center gap-3 text-kobipo-navy">
            <Calculator className="h-8 w-8 text-blue-500" />
            Muhasebe Paneli
          </h1>
          <p className="mt-1 text-kobipo-gray">
            Finansal özet ve işlemler
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{authContext.activeCompany.companyName}</p>
        </div>
      </div>

      {/* Ana İstatistikler */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border border-kobipo-border shadow-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Müşteriler</CardTitle>
            <Users className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{customerCount}</div>
            <Link href="/cari" className="text-xs text-blue-500 hover:underline">
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
            <div className="text-3xl font-bold">{supplierCount}</div>
            <Link href="/cari" className="text-xs text-purple-500 hover:underline">
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
            <div className="text-3xl font-bold">{invoiceCount}</div>
            <Link href="/e-donusum" className="text-xs text-green-500 hover:underline">
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
            <div className="text-3xl font-bold">{pendingInvoices}</div>
            <span className="text-xs text-muted-foreground">Taslak faturalar</span>
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

      {/* Son İşlemler ve Hızlı Erişim */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Son İşlemler</span>
              <Link href="/finans" className="text-sm text-blue-500 hover:underline font-normal">
                Tümü →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentTransactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Henüz işlem yok
              </div>
            ) : (
              <div className="space-y-2">
                {recentTransactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${tx.type === 'INCOME' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <div>
                        <p className="font-medium text-sm">{tx.description || tx.type}</p>
                        <p className="text-xs text-muted-foreground">
                          {tx.customer?.name || tx.supplier?.name || tx.account?.name}
                        </p>
                      </div>
                    </div>
                    <span className={`font-medium ${tx.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.type === 'INCOME' ? '+' : '-'}₺{Number(tx.amount).toLocaleString('tr-TR')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hızlı İşlemler</CardTitle>
            <CardDescription>Muhasebe işlemleri</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/e-donusum" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <FileText className="w-8 h-8 text-green-500" />
                <div>
                  <p className="font-medium text-sm">Yeni Fatura</p>
                  <p className="text-xs text-muted-foreground">Fatura oluştur</p>
                </div>
              </Link>

              <Link href="/cari/ekstre" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <Receipt className="w-8 h-8 text-blue-500" />
                <div>
                  <p className="font-medium text-sm">Cari Ekstre</p>
                  <p className="text-xs text-muted-foreground">Ekstre görüntüle</p>
                </div>
              </Link>

              <Link href="/finans" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <Wallet className="w-8 h-8 text-purple-500" />
                <div>
                  <p className="font-medium text-sm">Finans</p>
                  <p className="text-xs text-muted-foreground">Hesap hareketleri</p>
                </div>
              </Link>

              <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <TrendingUp className="w-8 h-8 text-orange-500" />
                <div>
                  <p className="font-medium text-sm">KDV Raporu</p>
                  <p className="text-xs text-muted-foreground">KDV hesapla</p>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

