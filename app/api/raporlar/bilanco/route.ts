import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeBalanceSheet } from "@/lib/raporlar/bilanco"

export const dynamic = 'force-dynamic'

/**
 * Bilanço. Hesabın kendisi `lib/raporlar/bilanco.ts`te — dışa aktarma ucu da
 * aynı fonksiyonu çağırır.
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
      await computeBalanceSheet({ companyId, asOfDate: searchParams.get("asOfDate") }),
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating balance sheet:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
