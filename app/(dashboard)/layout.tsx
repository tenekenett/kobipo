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

  const initialCompanies = userContext.companies.map((entry) => ({
    id: entry.companyId,
    name: entry.companyName,
    isEDonusumEnabled: entry.isEDonusumEnabled,
  }))
  const initialRole = userContext.companies[0]?.role ?? "VIEWER"

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
