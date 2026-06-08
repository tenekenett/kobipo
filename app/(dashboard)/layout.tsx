import { redirect } from "next/navigation"
import { getUserContext } from "@/lib/auth/user-context"
import { DashboardNav } from "@/components/dashboard/nav"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { CompanySelector } from "@/components/dashboard/company-selector"
import { DashboardCompanyProvider } from "@/components/dashboard/dashboard-company-provider"

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userContext = await getUserContext()
  if (!userContext) {
    redirect("/signin")
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
          <a
            href="/api/auth/signout?callbackUrl=/signin"
            className="mt-6 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            Çıkış Yap
          </a>
        </div>
      </div>
    )
  }

  const initialCompanies = visibleCompanies.map((entry) => ({
    id: entry.companyId,
    name: entry.companyName,
    isEDonusumEnabled: entry.isEDonusumEnabled,
    disabledModules: entry.disabledModules,
  }))
  const initialRole = visibleCompanies[0]?.role ?? "VIEWER"

  return (
    <DashboardCompanyProvider initialCompanies={initialCompanies} initialRole={initialRole}>
      <div className="min-h-screen bg-kobipo-offwhite dark:bg-background">
        <DashboardNav />
        <div className="min-w-0 pt-14 lg:pl-56 lg:pt-0">
          <div className="min-h-screen flex-1 bg-kobipo-offwhite dark:bg-background">
            <DashboardHeader />
            <div className="w-full min-w-0 overflow-x-clip p-4 sm:p-6">
              <CompanySelector />
              <div className="mt-4 w-full min-w-0">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </DashboardCompanyProvider>
  )
}
