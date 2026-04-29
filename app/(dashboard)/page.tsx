import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import { roleToDashboardPath } from "@/lib/auth/role-paths"
import { getAuthContext } from "@/lib/middleware/authorization"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await getSession()
  if (!session?.user) {
    redirect("/signin")
  }

  // Fast path: JWT already has the user's default company + role.
  const tokenCompanyId = session.user.defaultCompanyId
  const tokenRole = session.user.defaultRole
  if (tokenCompanyId && tokenRole) {
    const params = new URLSearchParams({ company: tokenCompanyId })
    redirect(`${roleToDashboardPath(tokenRole)}?${params.toString()}`)
  }

  // Fallback (older sessions): resolve via cached user context.
  const authContext = await getAuthContext()
  if (!authContext) {
    redirect("/signin")
  }
  if (authContext.companies.length === 0) {
    redirect("/companies/new")
  }
  const redirectCompany = authContext.activeCompany ?? authContext.companies[0]
  if (redirectCompany) {
    const params = new URLSearchParams({ company: redirectCompany.companyId })
    redirect(`${roleToDashboardPath(redirectCompany.role)}?${params.toString()}`)
  }
  return null
}
