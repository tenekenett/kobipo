import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import { getAuthContext, getDashboardPath } from "@/lib/middleware/authorization"

export const dynamic = "force-dynamic"

export default async function DashboardIndexPage() {
  const session = await getSession()

  if (!session) {
    redirect("/signin")
  }

  const authContext = await getAuthContext()

  if (!authContext) {
    redirect("/signin")
  }

  if (authContext.companies.length === 0) {
    redirect("/companies/new")
  }

  const targetRole = authContext.activeCompany?.role ?? authContext.companies[0].role
  redirect(getDashboardPath(targetRole))
}
