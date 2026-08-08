import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { fetchEkstre } from "@/lib/cari/ekstre-query"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

/**
 * Cari ekstre. Sorgunun kendisi `lib/cari/ekstre-query.ts`te — dışa aktarma ucu
 * da aynı fonksiyonu çağırır.
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
      await fetchEkstre({
        companyId,
        customerId: searchParams.get("customerId"),
        supplierId: searchParams.get("supplierId"),
        startDate: searchParams.get("startDate"),
        endDate: searchParams.get("endDate"),
      }),
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching ekstre:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
