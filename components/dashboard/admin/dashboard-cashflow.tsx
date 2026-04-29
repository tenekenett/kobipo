import { TrendingDown, TrendingUp, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { getAdminStats, getMonthlyCashflow } from "@/lib/dashboard/admin-queries"

interface DashboardCashflowProps {
  companyId: string
}

export async function DashboardCashflow({ companyId }: DashboardCashflowProps) {
  const [stats, chartData] = await Promise.all([
    getAdminStats(companyId),
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
