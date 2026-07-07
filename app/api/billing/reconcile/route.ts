import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import {
  applyEntitlements,
  getAccountSubscription,
  resolveGrantedModules,
} from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"

/**
 * Enforcement reconcile (Aşama 5) — süresi geçmiş deneme/abonelikleri EXPIRED'a çeker ve
 * etkilenen her hesap kökünde modül yetkilerini yeniden uygular (en güncel abonelik
 * durumuna göre `company.disabledModules` yazılır; expired → tüm modüller kilitlenir).
 *
 * Idempotent: aynı çalıştırma tekrar edilebilir. Recurring (Aşama 6) yinelenen ödemeyi
 * ÖNCE çalıştırıp aktif aboneliklerin süresini uzatır; bu uç yalnızca yenilenmeyenleri
 * kilitler. Oturumsuz — `BILLING_CRON_SECRET` ile korunur ([[lib/billing/cron-auth.ts]]).
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  try {
    // Süresi geçmiş denemeler + süresi geçmiş ücretli abonelikler.
    const stale = await prisma.subscription.findMany({
      where: {
        OR: [
          { status: "TRIAL", trialEndsAt: { lt: now } },
          { status: "ACTIVE", periodEnd: { lt: now } },
        ],
      },
      select: { id: true, companyId: true },
    })

    if (stale.length > 0) {
      await prisma.subscription.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: "EXPIRED" },
      })
    }

    // Etkilenen her hesap kökü için modülleri yeniden çöz. En güncel abonelik hâlâ aktifse
    // (ör. eski deneme expired ama yeni ücretli sub aktif) modüller açık kalır; değilse
    // hepsi kilitlenir. Kök başına tek kez (dedupe).
    const roots = Array.from(new Set(stale.map((s) => s.companyId)))
    for (const root of roots) {
      const latest = await getAccountSubscription(root)
      await applyEntitlements(root, resolveGrantedModules(latest, now))
    }

    return NextResponse.json({
      ok: true,
      expired: stale.length,
      accountsReconciled: roots.length,
    })
  } catch (error) {
    console.error("billing reconcile error:", error)
    return NextResponse.json({ error: "Reconcile başarısız" }, { status: 500 })
  }
}
