import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import { getAuthContext, getDashboardPath } from "@/lib/middleware/authorization"
import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { RevenueChart } from "@/components/dashboard/revenue-chart"

export const dynamic = "force-dynamic"

// Son 6 ayın adlarını al
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

export default async function DashboardPage() {
  const session = await getSession()

  if (!session) {
    redirect("/signin")
  }

  // Yetki bilgilerini al
  const authContext = await getAuthContext()

  if (!authContext) {
    redirect("/signin")
  }

  // Firmaya bağlı değilse firma oluşturma sayfasına yönlendir
  if (authContext.companies.length === 0) {
    redirect("/companies/new")
  }

  // Rol bazlı dashboard'a yönlendir
  if (authContext.activeCompany) {
    const dashboardPath = getDashboardPath(authContext.activeCompany.role)
    redirect(dashboardPath)
  }

  // İlk firmayı seç (veya cookie'den al)
  const activeCompany = authContext.companies[0]
  
  // Firma bilgilerini al
  const company = await prisma.company.findUnique({
    where: { id: activeCompany.companyId },
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  })

  if (!company) {
    redirect("/companies/new")
  }

  // Dashboard verileri
  const [
    customerCount,
    supplierCount,
    productCount,
    invoiceCount,
    recentInvoices,
    incomeTotal,
    expenseTotal,
  ] = await Promise.all([
    prisma.customer.count({ where: { companyId: activeCompany.companyId } }),
    prisma.supplier.count({ where: { companyId: activeCompany.companyId } }),
    prisma.product.count({ where: { companyId: activeCompany.companyId } }),
    prisma.invoice.count({ where: { companyId: activeCompany.companyId } }),
    prisma.invoice.findMany({
      where: { companyId: activeCompany.companyId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { customer: true, supplier: true },
    }),
    prisma.transaction.aggregate({
      where: { companyId: activeCompany.companyId, type: "INCOME" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { companyId: activeCompany.companyId, type: "EXPENSE" },
      _sum: { amount: true },
    }),
  ])

  // Aylık trend verileri
  const months = getLastSixMonths()
  const chartData = await Promise.all(
    months.map(async ({ month, start, end }) => {
      const [incomeResult, expenseResult] = await Promise.all([
        prisma.transaction.aggregate({
          where: {
            companyId: activeCompany.companyId,
            type: "INCOME",
            date: { gte: start, lte: end },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            companyId: activeCompany.companyId,
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
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Hoş geldiniz, {session.user?.name || session.user?.email}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{activeCompany.companyName}</p>
        </div>
      </div>

      {/* Özet Kartları */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Toplam Müşteri
            </CardTitle>
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{customerCount}</div>
            <Link href="/cari" className="text-xs text-blue-500 hover:underline">
              Tümünü görüntüle →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Toplam Tedarikçi
            </CardTitle>
            <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{supplierCount}</div>
            <Link href="/cari" className="text-xs text-purple-500 hover:underline">
              Tümünü görüntüle →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Toplam Ürün
            </CardTitle>
            <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{productCount}</div>
            <Link href="/stok" className="text-xs text-orange-500 hover:underline">
              Tümünü görüntüle →
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Toplam Fatura
            </CardTitle>
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{invoiceCount}</div>
            <Link href="/e-donusum" className="text-xs text-green-500 hover:underline">
              Tümünü görüntüle →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Finansal Özet */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400">
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
            <CardTitle className="text-sm font-medium text-red-700 dark:text-red-400">
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
            <CardTitle className={`text-sm font-medium ${balance >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'}`}>
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

      {/* Son Faturalar ve Hızlı Erişim */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Son Faturalar */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Son Faturalar</span>
              <Link href="/e-donusum" className="text-sm text-blue-500 hover:underline font-normal">
                Tümü →
              </Link>
            </CardTitle>
            <CardDescription>Son oluşturulan faturalar</CardDescription>
          </CardHeader>
          <CardContent>
            {recentInvoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <svg className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p>Henüz fatura oluşturulmamış</p>
                <Link href="/e-donusum" className="text-blue-500 hover:underline text-sm">
                  İlk faturanızı oluşturun →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentInvoices.map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
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

        {/* Hızlı Erişim */}
        <Card>
          <CardHeader>
            <CardTitle>Hızlı Erişim</CardTitle>
            <CardDescription>Sık kullanılan işlemler</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/cari" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-sm">Yeni Müşteri</p>
                  <p className="text-xs text-muted-foreground">Müşteri ekle</p>
                </div>
              </Link>

              <Link href="/e-donusum" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-sm">Yeni Fatura</p>
                  <p className="text-xs text-muted-foreground">Fatura oluştur</p>
                </div>
              </Link>

              <Link href="/stok" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-sm">Yeni Ürün</p>
                  <p className="text-xs text-muted-foreground">Ürün ekle</p>
                </div>
              </Link>

              <Link href="/raporlar" className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted transition-colors">
                <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
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
