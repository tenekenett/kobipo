// Paket/abonelik siparişinin PayTR ödeme bildirimi işleyicisi.
//
// Bildirim uçlarından değil, ortak yönlendiriciden çağrılır
// ([[lib/integrations/paytr/notification.ts]]) — hash doğrulaması ve sipariş bulma orada
// yapılır, burada yalnız abonelik akışının iş kuralı vardır.

import type { PackageOrder } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { isBillingCycle, type BillingCycle } from "@/lib/billing/constants"
import { applyEntitlements, periodEndFor } from "@/lib/billing/entitlements"
import type { NotificationResult, PaytrNotification } from "@/lib/integrations/paytr/notification"

/** Karar için gereken sipariş alanları. */
export type OrderSnapshot = {
  resolvedModules: string[]
  branchQuota: number
  billingCycle: string
}

/** Karar için gereken mevcut abonelik alanları. */
export type ExistingSubscription = {
  purchasedModules: string[]
  periodEnd: Date | null
}

/**
 * Ödeme sonrası aboneliğe ne yazılacağının kararı.
 *  - `quota-top-up`: yalnız kota güncellenir; durum/dönem/modüller ve yetkiler korunur.
 *  - `activate`: abonelik ACTIVE yazılır; `applyEntitlements` yalnız modül satın alındığında true.
 */
export type SubscriptionWrite =
  | { kind: "quota-top-up"; branchQuota: number }
  | {
      kind: "activate"
      purchasedModules: string[]
      branchQuota: number
      periodEnd: Date
      applyEntitlements: boolean
      /** Aboneliğin sahip olduğu ama siparişte olmayan modüller (uyarı/log için). */
      droppedModules: string[]
    }

/**
 * Ödeme sonrası abonelik yazımının SAF kararı — DB'ye dokunmaz, bu yüzden testlidir
 * ([[lib/billing/paytr-payment.test.ts]]).
 *
 * En kritik kural: **kota satın almak modül satın almak değildir.** Modülsüz bir sipariş
 * (yalnız şube kotası) için `purchasedModules = []` yazılıp `applyEntitlements(root, [])`
 * çağrılıyordu; bu da "bir şube daha alayım" diyen müşterinin ana firmasında VE tüm
 * şubelerinde her modülü kapatıyordu. Aynı kural sistem-admin elle kota verme ucunda da
 * geçerli ([[lib/billing/admin.ts]] → `setAccountBranchQuota`).
 *
 * İkinci kural: `periodEnd` asla geriye çekilmez — dönem ortasında yükseltme yapan
 * müşteri kalan ödenmiş süresini kaybetmez.
 */
export function planSubscriptionWrite(
  order: OrderSnapshot,
  existing: ExistingSubscription | null,
  now: Date,
): SubscriptionWrite {
  const cycle: BillingCycle = isBillingCycle(order.billingCycle) ? order.billingCycle : "MONTHLY"
  const freshPeriodEnd = periodEndFor(cycle, now)
  const quotaOnly = order.resolvedModules.length === 0 && order.branchQuota > 0

  if (quotaOnly) {
    // Mevcut abonelik varsa yalnız kotaya dokun. Yoksa satır aç ama MODÜL VERME
    // (şube ekleme aktif abonelik ister — app/api/companies/route.ts, fail-closed).
    if (existing) return { kind: "quota-top-up", branchQuota: order.branchQuota }
    return {
      kind: "activate",
      purchasedModules: [],
      branchQuota: order.branchQuota,
      periodEnd: freshPeriodEnd,
      applyEntitlements: false,
      droppedModules: [],
    }
  }

  const existingEnd = existing?.periodEnd ?? null
  return {
    kind: "activate",
    purchasedModules: order.resolvedModules,
    branchQuota: order.branchQuota,
    periodEnd:
      existingEnd && existingEnd.getTime() > freshPeriodEnd.getTime() ? existingEnd : freshPeriodEnd,
    applyEntitlements: true,
    droppedModules: (existing?.purchasedModules ?? []).filter(
      (m) => !order.resolvedModules.includes(m),
    ),
  }
}

/**
 * Başarılı bir paket siparişini aktif aboneliğe dönüştürür: hesabın (kök firma) en
 * güncel Subscription'ı varsa günceller, yoksa oluşturur; ardından satın alınan
 * modülleri ana firma + tüm şubelere uygular ([[lib/billing/entitlements.ts]]).
 *
 * İki mod var:
 *  - **Kota-only** (modülsüz sipariş): yalnız `branchQuota` güncellenir. Durum, dönem,
 *    modüller ve tutar snapshot'ına DOKUNULMAZ; `applyEntitlements` çağrılmaz. Böylece
 *    deneme süresi kısalmaz ve açık modüller kapanmaz.
 *  - **Paket/modül alımı**: abonelik ACTIVE'e alınır, modüller yazılır ve uygulanır.
 *    `periodEnd` asla geriye çekilmez (dönem ortasında yükseltme yapan müşteri kalan
 *    ödenmiş süresini kaybetmez).
 */
async function activateSubscription(order: PackageOrder): Promise<void> {
  const cycle: BillingCycle = isBillingCycle(order.billingCycle) ? order.billingCycle : "MONTHLY"
  const now = new Date()

  const existing = await prisma.subscription.findFirst({
    where: { companyId: order.companyId },
    orderBy: { createdAt: "desc" },
  })

  const write = planSubscriptionWrite(order, existing, now)

  if (write.kind === "quota-top-up") {
    // Kota takviyesi — abonelik satırının geri kalanı olduğu gibi kalır.
    await prisma.subscription.update({
      where: { id: existing!.id },
      data: { branchQuota: write.branchQuota, provider: "PAYTR", paymentRef: order.paymentRef },
    })
    console.log(
      `[billing-callback] order ${order.id}: kota takviyesi — branchQuota=${write.branchQuota} ` +
        `(modüller/dönem korundu, status=${existing!.status})`,
    )
    return
  }

  // Subscription.userId zorunlu: sipariş sahibi yoksa hesabın ilk ADMIN'ine bağla.
  let userId = order.createdById ?? existing?.userId ?? null
  if (!userId) {
    const admin = await prisma.userCompany.findFirst({
      where: { companyId: order.companyId, role: "ADMIN" },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    })
    userId = admin?.userId ?? null
  }
  if (!userId) {
    // Bağlanacak kullanıcı yoksa abonelik yazılamaz — sistem-admin sonradan düzeltebilir.
    console.error(`[billing-callback] order ${order.id}: hesapta ADMIN kullanıcı yok`)
    return
  }

  if (write.droppedModules.length > 0) {
    console.warn(
      `[billing-callback] order ${order.id}: abonelikten düşen modüller ` +
        `[${write.droppedModules.join(",")}] — sipariş bunları içermiyordu.`,
    )
  }

  const data = {
    userId,
    planId: order.planId,
    provider: "PAYTR",
    status: "ACTIVE",
    billingCycle: cycle,
    purchasedModules: write.purchasedModules,
    branchQuota: write.branchQuota,
    amount: order.amount,
    autoRenew: order.autoRenew,
    cancelAtPeriodEnd: false,
    paymentRef: order.paymentRef,
    periodStart: now,
    periodEnd: write.periodEnd,
  }

  if (existing) {
    await prisma.subscription.update({ where: { id: existing.id }, data })
  } else {
    await prisma.subscription.create({ data: { companyId: order.companyId, ...data } })
  }

  if (write.applyEntitlements) {
    await applyEntitlements(order.companyId, write.purchasedModules)
  }
}

/**
 * Başarılı ödemede sipariş ACTIVE'e geçer ve abonelik uygulanır. Idempotent:
 * PayTR aynı bildirimi birden çok kez gönderebilir.
 */
export async function handlePackageNotification(
  p: PaytrNotification,
  order: PackageOrder,
): Promise<NotificationResult> {
  // Idempotency: sipariş TAMAMEN işlendiyse (ACTIVE) tekrar işlem yapma. NOT: yalnızca
  // paidAt'e bakmıyoruz — ödeme kaydedilip abonelik yazımı yarıda kalmışsa (aşağıdaki
  // 3. adım öncesi hata) PayTR tekrar dener ve idempotent aktifleştirme tamamlanmalı.
  if (order.status === "ACTIVE") return "ok"

  if (p.status !== "success") {
    await prisma.packageOrder.update({
      where: { id: order.id },
      // PENDING_PAYMENT değil FAILED; kullanıcı yeni sipariş açıp tekrar deneyebilir.
      data: {
        status: "FAILED",
        paymentError: p.failedReasonMsg || "Ödeme başarısız",
        paymentRef: p.paymentType || null,
      },
    })
    return "ok"
  }

  // Ödeme başarılı. Sıra ÖNEMLİ ve status ACTIVE en son yazılır (tamamlanma işareti):
  // 1) ödemeyi kaydet, 2) aboneliği uygula (idempotent), 3) siparişi ACTIVE'e al.
  // Böylece 2. adım hata verirse sipariş ACTIVE olmaz, PayTR tekrar dener ve müşteri
  // ödediği halde modülsüz kalmaz. Tutar bütünlüğü hash ile garanti.
  const paid = await prisma.packageOrder.update({
    where: { id: order.id },
    data: {
      paidAt: order.paidAt ?? new Date(),
      paymentProvider: "PAYTR",
      paymentRef: p.paymentType || null,
      paymentError: null,
    },
  })

  await activateSubscription(paid)

  await prisma.packageOrder.update({ where: { id: order.id }, data: { status: "ACTIVE" } })
  return "ok"
}

/**
 * Ödemesi alındığı DOĞRULANMIŞ bir siparişi elle aktifleştirir (sistem-admin kurtarma
 * yolu). Bildirim kaybolduğunda / eski tek-uç hatası yüzünden PENDING kalmış siparişler
 * için; ödemenin gerçekten alındığı PayTR panelinden teyit edilerek kullanılır.
 */
export async function activatePackageOrderManually(orderId: string): Promise<PackageOrder> {
  const order = await prisma.packageOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new Error("Sipariş bulunamadı")
  if (order.status === "ACTIVE") return order

  const paid = await prisma.packageOrder.update({
    where: { id: order.id },
    data: {
      paidAt: order.paidAt ?? new Date(),
      paymentProvider: "PAYTR",
      paymentError: null,
    },
  })
  await activateSubscription(paid)
  return prisma.packageOrder.update({ where: { id: order.id }, data: { status: "ACTIVE" } })
}
