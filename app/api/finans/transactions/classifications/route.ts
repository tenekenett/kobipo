import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { loadClassificationOptions } from "@/lib/finans/siniflandirma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Gelir/gider işlem formunun kategori-etiket önerileri.
 *
 * Fatura formunun ucuyla (`/api/e-donusum/invoices/classifications`) AYNI kümeyi
 * döner; ayrı uç olmasının sebebi veri değil YETKİ: kasa ekranı fatura sayfası
 * izni olmadan da açılabilir.
 *
 * GET /api/finans/transactions/classifications?companyId=...
 *   → { categories: string[], tags: string[] }
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    await ensureCompanyAccess(companyId)

    return NextResponse.json(await loadClassificationOptions(companyId))
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("transaction classifications error:", error)
    return NextResponse.json(
      { error: message || "Kategori/etiket listesi alınamadı." },
      { status: 500 },
    )
  }
})
