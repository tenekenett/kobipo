import { redirect } from "next/navigation"
import { getUserContext } from "@/lib/auth/user-context"
import { DashboardNav } from "@/components/dashboard/nav"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { SidebarProvider } from "@/components/dashboard/sidebar-provider"
import { MainArea } from "@/components/dashboard/main-area"
import { CompanySelector } from "@/components/dashboard/company-selector"
import { BranchContextBanner } from "@/components/dashboard/branch-context-banner"
import { DashboardCompanyProvider } from "@/components/dashboard/dashboard-company-provider"
import { ModuleGuard } from "@/components/dashboard/module-guard"
import { SuspendedLogoutButton } from "@/components/dashboard/suspended-logout-button"

export const dynamic = 'force-dynamic'

// Uygulama paneli arama motorlarınca indekslenmemeli.
export const metadata = { robots: { index: false, follow: false } }

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userContext = await getUserContext()
  if (!userContext) {
    redirect("/signin")
  }

  // Blog editörü (platform hesabı, firma üyeliği yok) yalnız blog panelini görür.
  if (!userContext.isSuperAdmin && userContext.isBlogEditor && userContext.companies.length === 0) {
    redirect("/blog-admin")
  }

  // Pasif firmalar normal kullanıcıya gösterilmez (seçilemez); super admin hepsini görür.
  const visibleCompanies = userContext.companies.filter(
    (entry) => userContext.isSuperAdmin || entry.isActive
  )

  // Kullanıcının firması var ama hiçbiri aktif değilse (ve super admin değilse) hesap askıda.
  const accountSuspended =
    !userContext.isSuperAdmin &&
    userContext.companies.length > 0 &&
    visibleCompanies.length === 0

  if (accountSuspended) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-kobipo-offwhite p-6 dark:bg-background">
        <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 p-8 text-center dark:border-amber-900/60 dark:bg-amber-950/30">
          <h1 className="text-xl font-bold text-amber-900 dark:text-amber-100">
            Hesabınız askıya alınmış
          </h1>
          <p className="mt-2 text-sm text-amber-900/80 dark:text-amber-200/80">
            Firmanız şu anda pasif durumda. Erişiminizi yeniden açmak için lütfen sistem
            yöneticinizle iletişime geçin.
          </p>
          <SuspendedLogoutButton />
        </div>
      </div>
    )
  }

  const initialCompanies = visibleCompanies.map((entry) => ({
    id: entry.companyId,
    name: entry.companyName,
    isEDonusumEnabled: entry.isEDonusumEnabled,
    disabledModules: entry.disabledModules,
    isBranch: Boolean(entry.isBranch),
    parentName: entry.parentName ?? null,
  }))
  // Varsayılan rol: ilk ÜYE firma (şubeler listenin sonunda, sanal ADMIN).
  const initialRole =
    visibleCompanies.find((c) => !c.isBranch)?.role ?? visibleCompanies[0]?.role ?? "VIEWER"

  return (
    <DashboardCompanyProvider initialCompanies={initialCompanies} initialRole={initialRole}>
      <SidebarProvider>
        <div className="min-h-screen bg-kobipo-offwhite dark:bg-background">
          <DashboardNav />
          <MainArea>
            <DashboardHeader />
            <div className="w-full min-w-0 overflow-x-clip p-4 sm:p-6">
              <BranchContextBanner />
              <CompanySelector />
              <div className="mt-4 w-full min-w-0">
                <ModuleGuard>{children}</ModuleGuard>
              </div>
            </div>
          </MainArea>
        </div>
      </SidebarProvider>
    </DashboardCompanyProvider>
  )
}
