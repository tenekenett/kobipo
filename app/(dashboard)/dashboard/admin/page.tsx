import { Suspense } from "react"
import { redirect } from "next/navigation"
import { Settings } from "lucide-react"
import { Role } from "@prisma/client"
import { getAuthContext, resolveActiveCompany } from "@/lib/middleware/authorization"
import { roleToDashboardPath } from "@/lib/auth/role-paths"
import { withCompanyHref } from "@/lib/company/href"
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
import { LockedAccount } from "@/components/dashboard/locked-account"
import { isAccountLocked } from "@/lib/modules"
import { assertRouteAccessOrRedirect } from "@/lib/middleware/page-guard"

export const dynamic = "force-dynamic"

export default async function AdminDashboard({
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

  if (
    activeCompany.role !== Role.ADMIN &&
    activeCompany.role !== Role.BRANCH_MANAGER
  ) {
    // Rolün kendi paneline gönder — `/` panel değil, pazarlama sayfasıdır (app/page.tsx).
    // Firma param'ı korunmazsa kullanıcı ayrıca seçili şube/firmadan da düşer.
    redirect(withCompanyHref(roleToDashboardPath(activeCompany.role), activeCompany.companySlug))
  }

  // Kısıtlı çalışan panoyu göremez: pano ciro/kâr basıyor ve veriyi server
  // component çektiği için istemci guard'ı geç kalır (bkz. lib/middleware/page-guard.ts).
  assertRouteAccessOrRedirect(activeCompany, "/dashboard/admin", requested)

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
            <Settings className="h-8 w-8 text-purple-500" />
            Yönetici Paneli
          </h1>
          <p className="mt-1 text-kobipo-gray">
            Hoş geldiniz, {authContext.name || authContext.email}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Aktif Firma</p>
          <p className="font-semibold">{activeCompany.companyName}</p>
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
        <DashboardQuickActions companyId={companyId} />
      </div>
    </div>
  )
}
