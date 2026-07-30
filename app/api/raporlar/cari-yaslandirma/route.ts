import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeCariAging } from "@/lib/raporlar/cari-yaslandirma"

export const dynamic = "force-dynamic"

/**
 * Cari yaşlandırma. Hesabın kendisi `lib/raporlar/cari-yaslandirma.ts`te —
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
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    return NextResponse.json(await computeCariAging(companyId))
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating cari aging report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
