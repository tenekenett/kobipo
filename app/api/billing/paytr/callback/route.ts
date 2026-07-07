import { prisma } from "@/lib/db/prisma"
import { merchantOidBase, verifyCallbackHash } from "@/lib/integrations/paytr/client"
import { isBillingCycle, type BillingCycle } from "@/lib/billing/constants"
import { applyEntitlements, periodEndFor } from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"

// PayTR yalnızca gövdede düz "OK" görünce bildirimi tamamlanmış sayar; aksi halde
// tekrar dener. Bu yüzden ödeme kaydedildikten sonra DAİMA "OK" döneriz.
function ok() {
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } })
}

/**
 * Başarılı bir paket siparişini aktif aboneliğe dönüştürür: hesabın (kök firma) en
 * güncel Subscription'ı varsa ACTIVE'e günceller, yoksa oluşturur; ardından satın
 * alınan modülleri ana firma + tüm şubelere uygular ([[lib/billing/entitlements.ts]]).
 */
async function activateSubscription(order: {
  id: string
  companyId: string
  planId: string | null
  billingCycle: string
  resolvedModules: string[]
  branchQuota: number
  amount: unknown
  autoRenew: boolean
  paymentRef: string | null
  createdById: string | null
}) {
  const cycle: BillingCycle = isBillingCycle(order.billingCycle) ? order.billingCycle : "MONTHLY"
  const now = new Date()
  const periodEnd = periodEndFor(cycle, now)

  // Subscription.userId zorunlu: sipariş sahibi yoksa hesabın ilk ADMIN'ine bağla.
  let userId = order.createdById
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

  const existing = await prisma.subscription.findFirst({
    where: { companyId: order.companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })

  const data = {
    userId,
    planId: order.planId,
    provider: "PAYTR",
    status: "ACTIVE",
    billingCycle: cycle,
    purchasedModules: order.resolvedModules,
    branchQuota: order.branchQuota,
    amount: order.amount as any,
    autoRenew: order.autoRenew,
    cancelAtPeriodEnd: false,
    paymentRef: order.paymentRef,
    periodStart: now,
    periodEnd,
  }

  if (existing) {
    await prisma.subscription.update({ where: { id: existing.id }, data })
  } else {
    await prisma.subscription.create({ data: { companyId: order.companyId, ...data } })
  }

  await applyEntitlements(order.companyId, order.resolvedModules)
}

/**
 * PayTR ödeme bildirimi (sunucu-sunucu, OTURUMSUZ). Tek kimlik doğrulaması HMAC
 * hash'tir. Başarılı ödemede sipariş ACTIVE'e geçer ve abonelik uygulanır. Idempotent:
 * PayTR aynı bildirimi birden çok kez gönderebilir.
 *
 * Bildirim URL'si PayTR mağaza panelinden ayarlanır:
 *   https://<alan-adı>/api/billing/paytr/callback
 */
export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new Response("bad request", { status: 400 })
  }

  const merchantOid = String(form.get("merchant_oid") || "")
  const status = String(form.get("status") || "")
  const totalAmount = String(form.get("total_amount") || "")
  const hash = String(form.get("hash") || "")
  const failedReasonMsg = String(form.get("failed_reason_msg") || "")
  const paymentType = String(form.get("payment_type") || "")

  console.log(
    `[billing-callback] alındı: merchant_oid=${merchantOid} status=${status} total_amount=${totalAmount}`,
  )

  // Hash doğrulanamazsa OK DÖNME — sahte/bozuk istek reddedilir, gerçekse PayTR tekrar dener.
  if (!merchantOid || !verifyCallbackHash({ merchantOid, status, totalAmount, hash })) {
    console.warn(`[billing-callback] HASH DOĞRULANAMADI: merchant_oid=${merchantOid}`)
    return new Response("PAYTR notification failed: bad hash", { status: 400 })
  }

  try {
    // merchant_oid denemeye özel benzersiz üretilir (<id>X<suffix>); sipariş id'sine geri çöz.
    const order = await prisma.packageOrder.findUnique({ where: { id: merchantOidBase(merchantOid) } })
    // Bilinmeyen sipariş: tekrar denemenin anlamı yok, OK ile kapat.
    if (!order) return ok()

    // Idempotency: sipariş TAMAMEN işlendiyse (ACTIVE) tekrar işlem yapma. NOT: yalnızca
    // paidAt'e bakmıyoruz — ödeme kaydedilip abonelik yazımı yarıda kalmışsa (aşağıdaki
    // 3. adım öncesi hata) PayTR tekrar dener ve idempotent aktifleştirme tamamlanmalı.
    if (order.status === "ACTIVE") return ok()

    if (status !== "success") {
      await prisma.packageOrder.update({
        where: { id: order.id },
        // PENDING_PAYMENT değil FAILED; kullanıcı yeni sipariş açıp tekrar deneyebilir.
        data: {
          status: "FAILED",
          paymentError: failedReasonMsg || "Ödeme başarısız",
          paymentRef: paymentType || null,
        },
      })
      return ok()
    }

    // Ödeme başarılı. Sıra ÖNEMLİ ve status ACTIVE en son yazılır (tamamlanma işareti):
    // 1) ödemeyi kaydet, 2) aboneliği uygula (idempotent), 3) siparişi ACTIVE'e al.
    // Böylece 2. adım hata verirse sipariş ACTIVE olmaz, PayTR tekrar dener ve müşteri
    // ödediği halde modülsüz kalmaz. Tutar bütünlüğü hash ile garanti.
    await prisma.packageOrder.update({
      where: { id: order.id },
      data: {
        paidAt: order.paidAt ?? new Date(),
        paymentProvider: "PAYTR",
        paymentRef: paymentType || null,
        paymentError: null,
      },
    })

    await activateSubscription({
      id: order.id,
      companyId: order.companyId,
      planId: order.planId,
      billingCycle: order.billingCycle,
      resolvedModules: order.resolvedModules,
      branchQuota: order.branchQuota,
      amount: order.amount,
      autoRenew: order.autoRenew,
      paymentRef: paymentType || null,
      createdById: order.createdById,
    })

    await prisma.packageOrder.update({ where: { id: order.id }, data: { status: "ACTIVE" } })
    return ok()
  } catch (error) {
    console.error("billing paytr callback error:", error)
    // Aktifleştirme yapılamadıysa OK DÖNME ki PayTR tekrar denesin.
    return new Response("error", { status: 500 })
  }
}
