import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isRecurringEnabled } from "@/lib/integrations/paytr/client"
import { isAutoRenewActive } from "@/lib/billing/notice"
import { eventDate, logSubscriptionEvent } from "@/lib/billing/events"
import { getCompanySubscription, isInGracePeriod, isPaidActive } from "@/lib/billing/entitlements"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Otomatik yenilemeyi açar/kapatır (ADMIN).
 *
 * **İPTAL DEĞİLDİR** — fark hoşgörü süresindedir ve müşteri açısından günler eder:
 *
 * | | `autoRenew=false` | `cancelAtPeriodEnd=true` (iptal) |
 * |---|---|---|
 * | dönem sonunda | `PAST_DUE` → hoşgörü (7/15 gün) → `EXPIRED` | doğrudan `EXPIRED` |
 * | niyet | "bu ay kendiliğinden çekilmesin, elle öderim" | "bitsin" |
 *
 * Bu yüzden ikisi ayrı uçtur. Açma yönü ([[app/api/billing/subscription/cancel]])'in
 * tersini de yapar: `enabled=true`, iptal işaretini KALDIRIR — kullanıcı "yine
 * yenilensin" dediğinde ekranda ayrıca bir "iptali geri al" düğmesi aramak zorunda
 * kalmamalı.
 *
 * Body: { companyId, enabled }
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled (boolean) zorunlu" }, { status: 400 })
    }
    const enabled: boolean = body.enabled

    const access = await ensureCompanyAccess(companyId)
    if (access.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Abonelik yönetimi yalnızca firma yöneticisine açıktır" },
        { status: 403 },
      )
    }

    const sub = await getCompanySubscription(companyId)
    // Hoşgörüdeki abonelik de kapsamda: ödemesi aksamış müşterinin ilk yapacağı şey
    // otomatik yenilemeyi açmak olabilir, o kapıyı kapatmak anlamsız olurdu.
    if (!sub || !(isPaidActive(sub) || isInGracePeriod(sub))) {
      return NextResponse.json({ error: "Ücretli bir aboneliğiniz yok" }, { status: 400 })
    }

    const wasCancelling = sub.cancelAtPeriodEnd
    if (sub.autoRenew === enabled && (!enabled || !wasCancelling)) {
      // Idempotent: değişiklik yoksa olay günlüğüne gürültü yazma.
      return NextResponse.json({
        ok: true,
        autoRenew: sub.autoRenew,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        autoRenewActive: isAutoRenewActive(sub, isRecurringEnabled()),
      })
    }

    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        autoRenew: enabled,
        // Kapatma iptal DEĞİL: `cancelAtPeriodEnd`e yalnız AÇARKEN dokunulur.
        ...(enabled ? { cancelAtPeriodEnd: false } : {}),
      },
      select: {
        autoRenew: true,
        cancelAtPeriodEnd: true,
        periodEnd: true,
        provider: true,
        providerSubscriptionId: true,
      },
    })

    const active = isAutoRenewActive(updated, isRecurringEnabled())
    await logSubscriptionEvent({
      type: "AUTO_RENEW_CHANGED",
      companyId: sub.companyId,
      subscriptionId: sub.id,
      actor: "USER",
      actorUserId: user.id,
      summary: enabled
        ? `Otomatik yenileme açıldı${wasCancelling ? " (iptal geri alındı)" : ""} — dönem ${eventDate(updated.periodEnd)}`
        : `Otomatik yenileme kapatıldı — dönem ${eventDate(updated.periodEnd)} sonunda ödeme beklenecek`,
      detail: {
        autoRenew: updated.autoRenew,
        cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
        cancelRestored: enabled && wasCancelling,
        // "Açık ama çalışmayacak" hâli en sık kaçan durum (saklı kart yok / ürün kapalı).
        // Sonradan "neden çekilmedi" diye bakıldığında cevabın kayıtta olması şart.
        effective: active,
      },
    })

    return NextResponse.json({
      ok: true,
      autoRenew: updated.autoRenew,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      autoRenewActive: active,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("billing auto-renew error:", error)
    return NextResponse.json({ error: message || "Otomatik yenileme güncellenemedi" }, { status: 500 })
  }
})
