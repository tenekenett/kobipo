import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computePuantaj } from "@/lib/personel/puantaj"

export const dynamic = "force-dynamic"

/**
 * Aylık puantaj özeti.
 *
 * Hesabın kendisi `lib/personel/puantaj.ts`te: aynı satırları dışa aktarma
 * dataset'i de üretiyor ve ekranla dosyanın rakamı ayrışmamalı.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const year = Number(searchParams.get("year"))
  const month = Number(searchParams.get("month"))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month geçersiz" }, { status: 400 })
  }

  await ensureCompanyAccess(companyId)

  return NextResponse.json(await computePuantaj({ companyId, year, month }))
})
