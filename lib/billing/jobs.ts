// Abonelik bakım işleri (günlük cron) — TEK yerde, sırası belli.
//
// Neden burada: bu üç iş HTTP ucu olarak da elle çağrılabiliyor (`/api/billing/*`),
// ama günlük çalıştırmada SIRALARI önemli ve sıra bir cron yapılandırmasına
// bırakılamayacak kadar kritik:
//
//   1. notifyExpiring — kimseye dokunmaz, yalnız uyarır. ÖNCE koşar ki kullanıcı
//      "kapanacak" e-postasını kapanmadan önce alsın.
//   2. runRecurring   — vadesi geleni saklı kartla çeker; başarılıysa dönemi uzatır.
//   3. runReconcile   — yenilenmeyeni önce PAST_DUE'ya (hoşgörü), süresi dolanı
//      EXPIRED'a çeker ve modülleri kilitler. EN SON koşar ki 2. adımda yenilenen
//      abonelik yanlışlıkla kilitlenmesin.
//
// Uçlar bu fonksiyonların ince sarmalayıcısıdır; orkestratör `/api/billing/cron/daily`
// üçünü sırayla çağırır. Böylece sıra kodda garanti olur, cron yapılandırmasında değil.

import { prisma } from "@/lib/db/prisma"
import { chargeRecurringPayment, PAYTR_RECURRING_NOT_IMPLEMENTED } from "@/lib/integrations/paytr/client"
import { applyEntitlements, getAccountSubscription, periodEndFor, resolveGrantedModules } from "@/lib/billing/entitlements"
import { GRACE_PERIOD_DAYS, isBillingCycle } from "@/lib/billing/constants"
import {
  DAY_MS,
  NOTICE_WARN_DAYS,
  reconcileAction,
  shouldEmailToday,
  subscriptionNotice,
} from "@/lib/billing/notice"
import { subscriptionNoticeEmail } from "@/lib/email/templates"
import { sendEmailBatch } from "@/lib/email/resend"

/** PayTR'ın çekim isteğinde beklediği istemci IP'si; proxy arkasında header'dan gelir. */
export function clientIpFrom(request: Request): string {
  return (
    (request.headers.get("x-forwarded-for")?.split(",")[0] ||
      request.headers.get("x-real-ip") ||
      "").trim() || "0.0.0.0"
  )
}

// ---------------------------------------------------------------------------
// 1. Uyarı e-postaları
// ---------------------------------------------------------------------------

export type NotifyExpiringResult = {
  scanned: number
  matched: number
  sent: number
  failed: number
  skipped?: boolean
}

/**
 * Bitişi yaklaşan/geçen aboneliklerin ADMIN'lerine uyarı e-postası atar.
 * Hiçbir durumu DEĞİŞTİRMEZ — yalnız bildirir.
 */
export async function notifyExpiring(options: {
  baseUrl: string
  now?: Date
}): Promise<NotifyExpiringResult> {
  const now = options.now ?? new Date()
  const horizon = new Date(now.getTime() + (NOTICE_WARN_DAYS + 1) * DAY_MS)

  // Yalnız uyarı penceresine girenler. TRIAL dışarıda — deneme modül vermiyor.
  const candidates = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"] },
      periodEnd: { not: null, lte: horizon },
    },
    select: {
      id: true,
      companyId: true,
      status: true,
      periodEnd: true,
      cancelAtPeriodEnd: true,
      company: { select: { id: true, slug: true, name: true } },
    },
    orderBy: { periodEnd: "asc" },
  })

  const messages: { to: string; subject: string; html: string }[] = []
  let matched = 0

  for (const sub of candidates) {
    const notice = subscriptionNotice(sub, now)
    if (!notice || !shouldEmailToday(notice)) continue
    matched++

    // Yenileme yetkisi ADMIN'de; uyarı da onlara gider. Hesap kökü = abonelik firması.
    const admins = await prisma.userCompany.findMany({
      where: { companyId: sub.companyId, role: "ADMIN" },
      select: { user: { select: { email: true, name: true } } },
    })

    const renewUrl = `${options.baseUrl}/ayarlar/abonelik?company=${encodeURIComponent(
      sub.company.slug ?? sub.company.id
    )}`

    for (const admin of admins) {
      if (!admin.user?.email) continue
      const { subject, html } = subscriptionNoticeEmail({
        kind: notice.kind,
        daysLeft: notice.daysLeft,
        endsAt: notice.endsAt,
        locksAt: notice.locksAt,
        companyName: sub.company.name,
        renewUrl,
        userName: admin.user.name,
      })
      messages.push({ to: admin.user.email, subject, html })
    }
  }

  const result = await sendEmailBatch(messages)
  return { scanned: candidates.length, matched, ...result }
}

// ---------------------------------------------------------------------------
// 2. Yinelenen ödeme
// ---------------------------------------------------------------------------

export type RecurringResult = {
  due: number
  renewed: number
  failed: number
  pending: number
  skipped: number
  note?: string
}

/**
 * Vadesi gelmiş, otomatik yenilemeli PayTR aboneliklerini saklı kartla yeniden çeker.
 *
 * `PAST_DUE` olanlar da taranır: hoşgörü süresindeki bir abonelik her gün yeniden
 * denenmeli, aksi halde ilk başarısız çekimden sonra bir daha hiç denenmezdi.
 *
 * Gerçek çekim bugün [[lib/integrations/paytr/client.ts]] tarafından yapılMIYOR
 * (canlı recurring ürünü + saklı kart gerekir); o durumda abonelik DEĞİŞTİRİLMEZ.
 */
export async function runRecurring(options: {
  userIp?: string
  now?: Date
}): Promise<RecurringResult> {
  const now = options.now ?? new Date()
  const userIp = options.userIp?.trim() || "0.0.0.0"

  const due = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] },
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
        // TODO(faturalandırma): yenileme de bir SATIŞTIR ve faturalanmalıdır
        // (docs/faturalandirma/PLAN.md). Bugün buraya kanca takılmadı çünkü
        // `chargeRecurringPayment` iskeledir (daima NotImplemented fırlatır) ve
        // yenilemenin bir PackageOrder satırı üretip üretmeyeceği henüz belli değil —
        // otomatik fatura servisi siparişe bağlanır (`PackageOrder.invoiceId`).
        // Recurring canlıya alınırken: dönem için bir PackageOrder yazın (isTest=false,
        // paidAt=çekim anı, fatura bilgisi snapshot'ı abonelikten kopyalanır) ve
        // `issueInvoiceQuietly({ kind: "PACKAGE", orderId })` çağırın.
      } else {
        // Kart reddi vb. → PAST_DUE; hoşgörü süresi dolunca reconcile kilitler.
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } })
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

  return {
    due: due.length,
    renewed,
    failed,
    pending,
    skipped,
    note:
      pending > 0
        ? "Yinelenen çekim canlıya alınmadı; vadesi gelen abonelikler değiştirilmeden bırakıldı."
        : undefined,
  }
}

// ---------------------------------------------------------------------------
// 3. Uzlaştırma (hoşgörü + kilit)
// ---------------------------------------------------------------------------

export type ReconcileResult = {
  scanned: number
  /** Dönemi bitip hoşgörüye alınanlar — modülleri HÂLÂ AÇIK. */
  pastDue: number
  /** Süresi tamamen dolup kilitlenenler. */
  expired: number
  accountsReconciled: number
}

/**
 * Süresi geçmiş abonelikleri hoşgörü/kilit kurallarına göre günceller.
 * Karar `reconcileAction`'da (saf, testli); burası yalnız uygular.
 *
 * Idempotent: aynı çalıştırma tekrar edilebilir.
 */
export async function runReconcile(options: { now?: Date } = {}): Promise<ReconcileResult> {
  const now = options.now ?? new Date()

  // Hoşgörü penceresini de kapsayacak kadar geriye bak.
  const candidates = await prisma.subscription.findMany({
    where: {
      status: { in: ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"] },
      OR: [{ trialEndsAt: { lte: now } }, { periodEnd: { lte: now } }],
    },
    select: {
      id: true,
      companyId: true,
      status: true,
      periodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
    },
  })

  const toExpire: string[] = []
  const toPastDue: string[] = []
  const expiredRoots = new Set<string>()

  for (const sub of candidates) {
    const action = reconcileAction(sub, now, GRACE_PERIOD_DAYS)
    if (action === "expire") {
      toExpire.push(sub.id)
      expiredRoots.add(sub.companyId)
    } else if (action === "past_due") {
      toPastDue.push(sub.id)
    }
  }

  if (toPastDue.length > 0) {
    // DİKKAT: burada applyEntitlements ÇAĞRILMAZ. Hoşgörü süresinin tüm anlamı
    // modüllerin açık kalması; statü değişikliği yalnız sayacı başlatır.
    await prisma.subscription.updateMany({
      where: { id: { in: toPastDue } },
      data: { status: "PAST_DUE" },
    })
  }

  if (toExpire.length > 0) {
    await prisma.subscription.updateMany({
      where: { id: { in: toExpire } },
      data: { status: "EXPIRED" },
    })
  }

  // Kilitlenen her hesap kökü için modülleri yeniden çöz. En güncel abonelik hâlâ
  // aktifse (ör. eski deneme bitti ama yeni ücretli sub var) modüller açık kalır.
  for (const root of expiredRoots) {
    const latest = await getAccountSubscription(root)
    await applyEntitlements(root, resolveGrantedModules(latest, now))
  }

  return {
    scanned: candidates.length,
    pastDue: toPastDue.length,
    expired: toExpire.length,
    accountsReconciled: expiredRoots.size,
  }
}
