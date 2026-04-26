import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
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
  const session = await getSession()

  if (!session) {
    redirect("/signin")
  }

  return (
    <DashboardCompanyProvider>
      <div className="min-h-screen bg-kobipo-offwhite">
        <DashboardNav />
        <div className="min-w-0 pt-14 lg:pl-56 lg:pt-0">
          <div className="min-h-screen flex-1 bg-kobipo-offwhite">
            <DashboardHeader />
            <div className="w-full min-w-0 p-6">
              <CompanySelector />
              <div className="mt-4 w-full min-w-0">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </DashboardCompanyProvider>
  )
}
