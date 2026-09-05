import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeFinancialOverview } from "@/lib/raporlar/finansal-ozet"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Finansal panonun TEK ucu: kâr/zarar + önceki dönem + kasa + vade özeti +
 * 12 aylık seri. Hesabın kendisi `lib/raporlar/finansal-ozet.ts`te.
 *
 * Pano parça parça çağırmıyor çünkü her parça ayrı bir yetki kuralı isterdi ve
 * altı istek altı kez firma erişimi doğrulardı.
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
      await computeFinancialOverview({ companyId, period: searchParams.get("period") }),
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating financial overview:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
