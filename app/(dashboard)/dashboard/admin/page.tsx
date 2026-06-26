import { Suspense } from "react"
import { redirect } from "next/navigation"
import { Settings } from "lucide-react"
import { Role } from "@prisma/client"
import { getAuthContext } from "@/lib/middleware/authorization"
import { DashboardStats } from "@/components/dashboard/admin/dashboard-stats"
import { DashboardCashflow } from "@/components/dashboard/admin/dashboard-cashflow"
import { DashboardRecentInvoices } from "@/components/dashboard/admin/dashboard-recent-invoices"
import { DashboardQuickActions } from "@/components/dashboard/admin/dashboard-quick-actions"
import {
  CashflowChartSkeleton,
  CashflowSummarySkeleton,
  RecentInvoicesSkeleton,
  StatsSkeleton,
} from "@/components/dashboard/admin/skeletons"

export const dynamic = "force-dynamic"

export default async function AdminDashboard() {
  const authContext = await getAuthContext()

  if (!authContext || !authContext.activeCompany) {
    redirect("/signin")
  }

  if (
    authContext.activeCompany.role !== Role.ADMIN &&
    authContext.activeCompany.role !== Role.BRANCH_MANAGER
  ) {
    redirect("/")
  }

  const companyId = authContext.activeCompany.companyId

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3 text-kobipo-navy dark:text-foreground">
            <Settings className="h-8 w-8 text-purple-500" />
            Yönetici Paneli
          </h1>
          <p className="mt-1 text-kobipo-gray">
            Hoş geldiniz, {authContext.name || authContext.email}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{authContext.activeCompany.companyName}</p>
        </div>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        <DashboardStats companyId={companyId} />
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<RecentInvoicesSkeleton />}>
          <DashboardRecentInvoices companyId={companyId} />
        </Suspense>
        <DashboardQuickActions />
      </div>
    </div>
  )
}
