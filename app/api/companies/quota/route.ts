import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { getAccountQuotas } from "@/lib/billing/entitlements"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Aktif hesabın ŞUBE ve FİRMA kotası durumu — "kaç tane daha açabilirim" göstergesi.
 *
 * Açma denetimiyle AYNI fonksiyonu okur ([[lib/billing/entitlements.ts]] →
 * `getAccountQuotas`), böylece ekranın söylediğiyle API'nin izin verdiği ayrışmaz.
 * Kotalar hesap (kök firma) düzeyindedir: şubeden ya da ek firmadan bakılsa da hesabın
 * kotası döner. İki kota ayrı havuzdur; şube açmak firma hakkını yemez.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

  try {
    await ensureCompanyAccess(companyId)
    return NextResponse.json(await getAccountQuotas(companyId))
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) return accessDeniedResponse(error)
    console.error("companies quota GET error:", error)
    return NextResponse.json({ error: "Kota okunamadı" }, { status: 500 })
  }
}
