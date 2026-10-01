import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { parseYearParam, parseMonthParam } from "@/lib/http/query-params"
import { badRequestResponse } from "@/lib/api/errors"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, pagePermissionsOf } from "@/lib/middleware/company"
import { canViewPage } from "@/lib/page-access"
import { computeMuhtasar } from "@/lib/raporlar/vergiler"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

/**
 * Muhtasar beyanname hazırlık raporu — bordrolardan. Hesabın kendisi
 * `lib/raporlar/vergiler.ts`te — dışa aktarma ucu da aynı fonksiyonu çağırır.
 *
 * Kişi başı maaş dökümü yalnız Maaş sayfasını açabilene döner; vergi raporunu
 * görebilen diğer roller (muhasebeci, görüntüleyici) toplamları görür.
 *
 * NOT: `format=csv` sayfalarda kullanılmıyor; düzgün kaçışlı/antetli çıktı için
 * `/api/export/rapor-vergiler` kullanılmalı.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const year = parseYearParam(searchParams.get("year")) ?? new Date().getFullYear()
    const month = parseMonthParam(searchParams.get("month")) ?? new Date().getMonth() + 1

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    const uyelik = await ensureCompanyAccess(companyId)
    const calisanDetayi = canViewPage(pagePermissionsOf(uyelik), "/personel/maas")

    return NextResponse.json(await computeMuhtasar({ companyId, year, month, calisanDetayi }))
  } catch (error: any) {
    const __bad = badRequestResponse(error)
    if (__bad) return __bad
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating withholding tax declaration:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})
