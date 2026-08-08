import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { getAccountSubscription } from "@/lib/billing/entitlements"
import { subscriptionNotice } from "@/lib/billing/notice"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Panel üstündeki abonelik uyarı şeridini besleyen HAFİF uç.
 *
 * `/api/billing/catalog` de bu bilgiyi taşıyor ama yanında paketleri, fiyat listesini ve
 * şube sayımını da getiriyor; banner her sayfada duruyor, o yüzden ayrı ve ucuz bir uç
 * gerekli. Modül kapısına tabi DEĞİL (bkz. lib/module-access.ts): kilitli hesap da
 * aboneliğinin durumunu görebilmeli, zaten satın alma ekranına yönlendiriliyor.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    const context = await ensureCompanyAccess(companyId)
    const sub = await getAccountSubscription(companyId)
    const notice = subscriptionNotice(sub)

    return NextResponse.json({
      notice: notice
        ? {
            kind: notice.kind,
            endsAt: notice.endsAt.toISOString(),
            locksAt: notice.locksAt.toISOString(),
            daysLeft: notice.daysLeft,
            cancelling: notice.cancelling,
          }
        : null,
      // Yenileme yalnız ADMIN'in işi; diğer roller yöneticiye yönlendirilir.
      canPurchase: context.role === "ADMIN",
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("billing notice error:", error)
    return NextResponse.json({ error: "Abonelik durumu okunamadı" }, { status: 500 })
  }
}
