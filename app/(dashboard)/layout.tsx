import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import { DashboardNav } from "@/components/dashboard/nav"
import { CompanySelector } from "@/components/dashboard/company-selector"

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
    <div className="min-h-screen bg-background">
      <DashboardNav />
      <div className="pt-20 lg:pl-72 lg:pt-0">
        <div className="container mx-auto p-4 md:p-6 lg:p-8">
        <CompanySelector />
        <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  )
}
