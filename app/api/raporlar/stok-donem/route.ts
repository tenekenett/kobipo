import { NextResponse } from "next/server"
import { parseDateParam } from "@/lib/http/query-params"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { computeStockPeriodFlows } from "@/lib/raporlar/stok-donem"

export const dynamic = "force-dynamic"

/**
 * Stok raporunun dönem sütunları (giriş / satış / reçete / diğer) — ürün id'sine
 * göre. Hesap `lib/raporlar/stok-donem.ts`te; dışa aktarım da oradan okur.
 */
export const GET = withApiErrors(async function GET(request: Request) {
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

  const result = await computeStockPeriodFlows({
    companyId,
    startDate: parseDateParam(searchParams.get("startDate"), "startDate"),
    endDate: parseDateParam(searchParams.get("endDate"), "endDate"),
  })

  return NextResponse.json({
    start: result.start.toISOString(),
    endExclusive: result.endExclusive.toISOString(),
    flows: Object.fromEntries(result.byProduct),
  })
})
