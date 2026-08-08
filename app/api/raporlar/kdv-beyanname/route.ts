import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeVatDeclaration, type VatPeriod } from "@/lib/raporlar/vergiler"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

/**
 * KDV beyanname hazırlık raporu. Hesabın kendisi `lib/raporlar/vergiler.ts`te —
 * dışa aktarma ucu da aynı fonksiyonu çağırır.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const period = (searchParams.get("period") || "monthly") as VatPeriod
    const year = Number(searchParams.get("year")) || new Date().getFullYear()
    const month = Number(searchParams.get("month")) || new Date().getMonth() + 1

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    return NextResponse.json(await computeVatDeclaration({ companyId, period, year, month }))
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating VAT declaration:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
