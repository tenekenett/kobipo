import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeStockMovementReport } from "@/lib/raporlar/stok-hareket"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Stok hareket raporu. Hesabın kendisi `lib/raporlar/stok-hareket.ts`te — dışa
 * aktarma ucu da aynı fonksiyonu çağırır.
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
      await computeStockMovementReport({
        companyId,
        startDate: searchParams.get("startDate"),
        endDate: searchParams.get("endDate"),
        customerId: searchParams.get("customerId"),
        supplierId: searchParams.get("supplierId"),
        class1Id: searchParams.get("class1Id"),
        class2Id: searchParams.get("class2Id"),
        productId: searchParams.get("productId"),
        search: searchParams.get("search"),
      })
    )
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating stock movement report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
