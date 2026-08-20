import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeHrReport } from "@/lib/raporlar/personel"

export const dynamic = "force-dynamic"

/**
 * Personel (İK) raporu. Hesabın kendisi `lib/raporlar/personel.ts`te — dışa
 * aktarma ucu da aynı fonksiyonu çağırır.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const year = Number(searchParams.get("year")) || new Date().getFullYear()
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  return NextResponse.json(await computeHrReport({ companyId, year }))
})
