import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { listEBelgeArsivi } from "@/lib/faturalar/e-belge-arsivi"

export const dynamic = "force-dynamic"

/**
 * Satış Faturaları → "e-Faturaları İndir" / "e-Fatura XML İndir" için belge listesi
 * (GİB'e gönderilmiş e-Fatura/e-Arşiv). Kurallar: lib/faturalar/e-belge-arsivi.ts.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  await ensureCompanyExport(companyId)
  return listEBelgeArsivi(companyId, url.searchParams, "satis")
})
