import { NextResponse } from "next/server"
import { parseDateParam } from "@/lib/http/query-params"
import { badRequestResponse } from "@/lib/api/errors"

import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeIncomeExpense } from "@/lib/raporlar/gelir-gider"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Gelir-gider (karlılık) raporu — kategori/etiket/cari/ay kırılımlı.
 *
 * Bu uç 2026-09-05'e kadar ÖLÜYDÜ: hiçbir ekran çağırmıyordu, `totalAmount`
 * (KDV dahil) topluyordu ve kırılımı yoktu. Hesap artık
 * `lib/raporlar/gelir-gider.ts`te ve kâr/zararla aynı ölçüyü kullanıyor.
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
      await computeIncomeExpense({
        companyId,
        startDate: parseDateParam(searchParams.get("startDate"), "startDate"),
        endDate: parseDateParam(searchParams.get("endDate"), "endDate"),
      }),
    )
  } catch (error: any) {
    const __bad = badRequestResponse(error)
    if (__bad) return __bad
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating income/expense report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
