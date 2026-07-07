import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { chargeRecurringPayment, PAYTR_RECURRING_NOT_IMPLEMENTED } from "@/lib/integrations/paytr/client"
import { applyEntitlements, periodEndFor } from "@/lib/billing/entitlements"
import { isBillingCycle } from "@/lib/billing/constants"

export const dynamic = "force-dynamic"

/**
 * Recurring (yinelenen ödeme) çalıştırıcı — İSKELE (Aşama 6). Vadesi gelmiş, otomatik
 * yenilemeli PayTR aboneliklerini saklı kartla yeniden çeker.
 *
 * **Sıra önemli:** cron'da ÖNCE bu uç, SONRA `/api/billing/reconcile` çağrılmalı. Böylece
 * başarıyla yenilenen aboneliklerin `periodEnd`'i uzar ve reconcile onları kilitlemez;
 * yalnızca yenilenemeyenler süresi dolunca kilitlenir.
 *
 * Şu an gerçek çekim [[lib/integrations/paytr/client.ts]] `chargeRecurringPayment` tarafından
 * bilinçli olarak yapılmaz (canlı PayTR recurring ürünü + saklı kart gerekir); bu durumda
 * abonelik durumu DEĞİŞTİRİLMEZ (`pending`). Canlıya alındığında aşağıdaki başarı/başarısızlık
 * dalları devreye girer. Oturumsuz — `BILLING_CRON_SECRET` ile korumalı.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const userIp =
    (request.headers.get("x-forwarded-for")?.split(",")[0] ||
      request.headers.get("x-real-ip") ||
      "").trim() || "0.0.0.0"

  try {
    // Vadesi gelmiş, yenilenmesi gereken ücretli abonelikler.
    const due = await prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        provider: "PAYTR",
        autoRenew: true,
        cancelAtPeriodEnd: false,
        periodEnd: { lte: now },
      },
      select: {
        id: true,
        companyId: true,
        billingCycle: true,
        purchasedModules: true,
        amount: true,
        periodEnd: true,
        providerSubscriptionId: true,
        user: { select: { email: true } },
      },
    })

    let renewed = 0
    let failed = 0
    let pending = 0
    let skipped = 0

    for (const sub of due) {
      const cardToken = sub.providerSubscriptionId
      const amountKurus = sub.amount != null ? Math.round(Number(sub.amount) * 100) : 0
      // Saklı kart token'ı veya tutar yoksa çekilemez (henüz recurring kurulmamış olabilir).
      if (!cardToken || amountKurus <= 0) {
        skipped++
        continue
      }

      const cycle = isBillingCycle(sub.billingCycle) ? sub.billingCycle : "MONTHLY"
      // Dönem başına deterministik merchant_oid → cron iki kez koşarsa PayTR çift çekimi reddeder.
      const merchantOid = `rec${sub.id}${(sub.periodEnd ?? now).getTime()}`

      try {
        const result = await chargeRecurringPayment({
          merchantOid,
          cardToken,
          paymentAmount: amountKurus,
          email: sub.user?.email || "musteri@kobipo.com",
          userIp,
        })

        if (result.success) {
          // Başarı → dönemi bir önceki bitişten itibaren uzat, modülleri yeniden uygula.
          const newStart = sub.periodEnd ?? now
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              status: "ACTIVE",
              periodStart: newStart,
              periodEnd: periodEndFor(cycle, newStart),
              paymentRef: result.paymentRef ?? null,
            },
          })
          await applyEntitlements(sub.companyId, sub.purchasedModules)
          renewed++
        } else {
          // Kart reddi vb. → PAST_DUE; sonraki reconcile süresi dolunca kilitler.
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: "PAST_DUE" },
          })
          failed++
        }
      } catch (error: any) {
        // İSKELE (NotImplemented) veya geçici hata → durumu DEĞİŞTİRME, tekrar denenecek.
        if (error?.message !== PAYTR_RECURRING_NOT_IMPLEMENTED) {
          console.error(`recurring charge error (sub ${sub.id}):`, error)
        }
        pending++
      }
    }

    return NextResponse.json({
      ok: true,
      due: due.length,
      renewed,
      failed,
      pending,
      skipped,
      note:
        pending > 0
          ? "Yinelenen çekim canlıya alınmadı; vadesi gelen abonelikler değiştirilmeden bırakıldı."
          : undefined,
    })
  } catch (error) {
    console.error("billing recurring run error:", error)
    return NextResponse.json({ error: "Recurring çalıştırılamadı" }, { status: 500 })
  }
}
