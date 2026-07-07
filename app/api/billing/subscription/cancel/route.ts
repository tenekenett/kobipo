import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { getAccountSubscription, isPaidActive } from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"

/**
 * Aboneliği dönem sonunda iptal eder (ADMIN). `autoRenew=false` + `cancelAtPeriodEnd=true`
 * yazar; abonelik `periodEnd`'e kadar ACTIVE kalır ve modüller açık kalır. Süre dolunca
 * reconcile ([[app/api/billing/reconcile/route.ts]]) aboneliği EXPIRED yapıp modülleri kilitler.
 *
 * Body: { companyId }
 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    const access = await ensureCompanyAccess(companyId)
    if (access.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Abonelik yönetimi yalnızca firma yöneticisine açıktır" },
        { status: 403 },
      )
    }

    const sub = await getAccountSubscription(companyId)
    if (!sub || !isPaidActive(sub)) {
      return NextResponse.json({ error: "İptal edilecek aktif abonelik yok" }, { status: 400 })
    }
    if (sub.cancelAtPeriodEnd) {
      // Zaten iptal işaretli — idempotent, mevcut durumu döndür.
      return NextResponse.json({ ok: true, cancelAtPeriodEnd: true, periodEnd: sub.periodEnd })
    }

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: { autoRenew: false, cancelAtPeriodEnd: true },
      select: { autoRenew: true, cancelAtPeriodEnd: true, periodEnd: true },
    })

    return NextResponse.json({ ok: true, ...updated })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("billing subscription cancel error:", error)
    return NextResponse.json({ error: message || "Abonelik iptal edilemedi" }, { status: 500 })
  }
}
