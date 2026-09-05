import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeCashProjection } from "@/lib/raporlar/nakit-projeksiyon"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * İleriye dönük nakit projeksiyonu (12 hafta / 12 ay). Hesap
 * `lib/raporlar/nakit-projeksiyon.ts`te; geçmişe bakan tablo ise
 * `/api/raporlar/nakit-akisi`.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    return NextResponse.json(
      await computeCashProjection({
        companyId,
        granularity: searchParams.get("granularity"),
      }),
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating cash projection:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
