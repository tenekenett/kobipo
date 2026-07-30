import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeWithholding } from "@/lib/raporlar/vergiler"

export const dynamic = 'force-dynamic'

/**
 * Muhtasar beyanname hazırlık raporu. Hesabın kendisi
 * `lib/raporlar/vergiler.ts`te — dışa aktarma ucu da aynı fonksiyonu çağırır.
 *
 * NOT: `format=csv` sayfalarda kullanılmıyor; düzgün kaçışlı/antetli çıktı için
 * `/api/export/rapor-vergiler` kullanılmalı.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const year = Number(searchParams.get("year")) || new Date().getFullYear()
    const month = Number(searchParams.get("month")) || new Date().getMonth() + 1

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    return NextResponse.json(await computeWithholding({ companyId, year, month }))
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating withholding tax declaration:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
