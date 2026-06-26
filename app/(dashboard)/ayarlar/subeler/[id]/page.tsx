import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Role } from "@prisma/client"
import { ArrowLeft, ArrowRight, Building2 } from "lucide-react"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { DashboardStats } from "@/components/dashboard/admin/dashboard-stats"
import { DashboardCashflow } from "@/components/dashboard/admin/dashboard-cashflow"
import { DashboardRecentInvoices } from "@/components/dashboard/admin/dashboard-recent-invoices"
import {
  StatsSkeleton,
  CashflowSummarySkeleton,
  CashflowChartSkeleton,
  RecentInvoicesSkeleton,
} from "@/components/dashboard/admin/skeletons"

export const dynamic = "force-dynamic"

export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Yetki: bu firmaya/şubeye erişimi olmalı (ana firma ADMIN'i ya da kendisinin
  // ADMIN'i). ensureCompanyAccess parent-admin şubelerini de kapsar.
  let ctx
  try {
    ctx = await ensureCompanyAccess(id)
  } catch {
    notFound()
  }
  if (ctx.role !== Role.ADMIN) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href="/ayarlar/subeler"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Şube Yönetimi
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-kobipo-navy dark:text-foreground">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            {ctx.companyName}
            {ctx.isBranch && (
              <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                Şube{ctx.parentName ? ` · ${ctx.parentName}` : ""}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            Ciro, fatura ve nakit akışı özeti. İşlem yapmak için şube bağlamına geçin.
          </p>
        </div>

        <Link
          href={`/dashboard?company=${encodeURIComponent(id)}`}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Şubeye gir (işlem yap)
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        <DashboardStats companyId={id} />
      </Suspense>

      <Suspense
        fallback={
          <div className="space-y-4">
            <CashflowSummarySkeleton />
            <CashflowChartSkeleton />
          </div>
        }
      >
        <DashboardCashflow companyId={id} />
      </Suspense>

      <Suspense fallback={<RecentInvoicesSkeleton />}>
        <DashboardRecentInvoices companyId={id} />
      </Suspense>
    </div>
  )
}
