import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeCashFlow } from "@/lib/raporlar/nakit-akisi"

export const dynamic = 'force-dynamic'

/**
 * Nakit akış tablosu. Hesabın kendisi `lib/raporlar/nakit-akisi.ts`te — dışa
 * aktarma ucu da aynı fonksiyonu çağırır.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    return NextResponse.json(
      await computeCashFlow({
        companyId,
        startDate: searchParams.get("startDate"),
        endDate: searchParams.get("endDate"),
      }),
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating cash flow report:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
