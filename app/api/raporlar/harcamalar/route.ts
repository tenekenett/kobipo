import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeExpenseReport } from "@/lib/raporlar/harcamalar"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Harcamalar raporu: kategori ağacı + harcama defteri. Hesap
 * `lib/raporlar/harcamalar.ts`te; dışa aktarma ucu da aynı fonksiyonu çağırır
 * (tek fark: dosyada kalem tavanı yok).
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
      await computeExpenseReport({
        companyId,
        startDate: searchParams.get("startDate"),
        endDate: searchParams.get("endDate"),
        category: searchParams.get("category"),
      }),
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating expense report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
