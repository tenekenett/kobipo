import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, pagePermissionsOf } from "@/lib/middleware/company"
import { resolveCariVisibility } from "@/lib/cari/resolve-visibility"
import { accessDeniedResponse, badRequestResponse, withApiErrors } from "@/lib/api/errors"
import { aramaTerimi } from "@/lib/arama/kayit-arama-kural"
import { kayitAra } from "@/lib/arama/kayit-arama"

export const dynamic = "force-dynamic"

/**
 * Genel kayıt araması — üst çubuktaki arama kutusu (`components/dashboard/menu-search.tsx`).
 *
 * Yalnız OKUR. Sonuç kullanıcının AÇABİLDİĞİ kayıtlardır: liste + detay sayfası
 * yetkisi ve modül durumu `kayit-arama-kural.ts`te, cari görünürlüğü sorguda.
 * Kapı (`ensureCompanyAccess`) firmaya erişimi doğrular; hangi kaydın görüneceği
 * kararı burada verilemez, çünkü tek uç birden çok sayfanın kaydını döndürür.
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

    const uyelik = await ensureCompanyAccess(companyId)
    const terim = aramaTerimi(searchParams.get("q"))
    if (!terim) return NextResponse.json({ gruplar: [] })

    const gruplar = await kayitAra({
      companyId,
      terim,
      perms: pagePermissionsOf(uyelik),
      disabledModules: uyelik.disabledModules ?? [],
      visibility: await resolveCariVisibility(companyId),
    })
    return NextResponse.json({ gruplar })
  } catch (error: any) {
    const bad = badRequestResponse(error)
    if (bad) return bad
    if (String(error?.message ?? "").includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Kayıt araması başarısız:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
