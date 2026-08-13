import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { getBranchQuotaStatus } from "@/lib/billing/entitlements"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Aktif hesabın şube kotası durumu — "kaç şube daha açabilirim" göstergesi için.
 *
 * Şube açma denetimiyle AYNI fonksiyonu okur ([[lib/billing/entitlements.ts]] →
 * `getBranchQuotaStatus`), böylece ekranın söylediğiyle API'nin izin verdiği ayrışmaz.
 * Kota hesap (kök firma) düzeyindedir: şubeden bakılsa da ana firmanın kotası döner.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  try {
    await ensureCompanyAccess(companyId)
    return NextResponse.json(await getBranchQuotaStatus(companyId))
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) return accessDeniedResponse(error)
    console.error("branch-quota GET error:", error)
    return NextResponse.json({ error: "Şube kotası okunamadı" }, { status: 500 })
  }
}
