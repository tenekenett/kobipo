import { NextResponse } from "next/server"
import { withApiErrors } from "@/lib/api/errors"
import { getCurrentUser } from "@/lib/auth/session"
import { listRoleTemplates } from "@/lib/nav/role-templates.server"

export const dynamic = "force-dynamic"

/**
 * Firmaya sunulan hazır rol kalıpları (Rol Yetkileri ekranındaki kartlar).
 *
 * Katalog GENELDİR, firmaya göre değişmez — o yüzden companyId almaz. Kalıbın hangi
 * sayfalarının o firmada kullanılabildiği istemcide süzülür (`filterAvailablePages`),
 * çünkü süzgeç firmanın açık modüllerine bağlıdır ve kalıp o firmaya ait değildir.
 *
 * Yalnız AKTİF kalıplar döner: pasifleştirilmiş bir kalıp "artık önermiyoruz"
 * demektir; ondan üretilmiş roller çalışmaya devam eder.
 */
export const GET = withApiErrors(async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await listRoleTemplates())
})
