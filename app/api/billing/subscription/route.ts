import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isRecurringEnabled } from "@/lib/integrations/paytr/client"
import { freeModulesFromPricingItems } from "@/lib/billing/free-modules"
import { applySuppression } from "@/lib/modules"
import { EVENT_LABELS, getSubscriptionEvents, type SubscriptionEventType } from "@/lib/billing/events"
import { isAutoRenewActive, subscriptionNotice } from "@/lib/billing/notice"
import {
  getAccountQuotas,
  getCompanySubscription,
  isInGracePeriod,
  isPaidActive,
  isTrialActive,
  resolveAccountRootId,
  resolveGrantedModules,
} from "@/lib/billing/entitlements"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * "Aboneliğim" ekranının TEK ucu: hesabın abonelik durumu + kota kullanımı + açık
 * modüller + ödeme geçmişi + olay günlüğü.
 *
 * Neden `/api/billing/catalog`tan ayrı: katalog SATIN ALMA ekranını besler (satılabilir
 * paketler, fiyat listesi) ve aboneliği yalnız "üstüne yazılacak taban" olarak taşır.
 * Buradaki sorular farklı: kaç gün kaldı, kartım hangisi, ne zaman ne oldu, faturam
 * nerede. İkisini tek uçta birleştirmek, her satın alma turunda sipariş geçmişini ve
 * olay günlüğünü de çekmek demek olurdu.
 *
 * Abonelik FİRMA düzeyindedir (şube kendi satırını taşır); yalnız KOTA hesap kökünden
 * okunur — şube/ek firma açma hakkı orada tutulur.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    const access = await ensureCompanyAccess(companyId)
    const rootId = await resolveAccountRootId(companyId)
    const isAccountAdmin =
      rootId === companyId ||
      user.isSuperAdmin ||
      (await prisma.userCompany.findFirst({
        where: { userId: user.id, companyId: rootId, role: "ADMIN" },
        select: { id: true },
      })) != null

    const recurringEnabled = isRecurringEnabled()
    const [sub, quotas, pricing, orders, events] = await Promise.all([
      getCompanySubscription(companyId),
      getAccountQuotas(rootId),
      prisma.pricingItem.findMany({ select: { key: true, isFree: true, isActive: true } }),
      // ÖDEME GEÇMİŞİ: bekleyen sipariş "geçmiş" değildir — kullanıcı ödemeyi yarıda
      // bıraktıysa listede "ödeme" gibi durmamalı. Başarısız/iptal olanlar KALIR:
      // "param gitti mi" sorusunun cevabı da bu listede aranıyor.
      prisma.packageOrder.findMany({
        // Sipariş ve olaylar da FİRMANIN: şube kendi ödemesini yapıyor, ana firmanın
        // ödeme geçmişini görmesi (ya da tersi) yanlış olurdu.
        where: { companyId, status: { in: ["ACTIVE", "FAILED", "CANCELLED"] } },
        orderBy: { createdAt: "desc" },
        take: 24,
        select: {
          id: true,
          status: true,
          planName: true,
          billingCycle: true,
          amount: true,
          discountCode: true,
          discountAmount: true,
          currency: true,
          paidAt: true,
          paymentError: true,
          createdAt: true,
          // Fatura indirme kapısı: uç yalnız GİB'e GÖNDERİLMİŞ faturayı verir
          // (invoice-pdf → 409). Butonu ancak o hâlde göstermek için durum da lazım.
          invoiceId: true,
          invoice: { select: { status: true, invoiceNo: true, eDocumentNo: true } },
        },
      }),
      getSubscriptionEvents(companyId, 20),
    ])

    const free = freeModulesFromPricingItems(pricing)
    const granted = resolveGrantedModules(sub)
    // ELLE KAPATMA firma bazındadır: abonelik hesabın olsa da "açık modüller" listesi
    // EKRANIN AÇIK OLDUĞU firmanın gerçeğini söylemeli. Düşülmezse sistem yöneticisinin
    // kapattığı modül burada "açık" görünür — şikâyetin ta kendisi.
    const suppressed = (
      await prisma.company.findUnique({
        where: { id: companyId },
        select: { suppressedModules: true },
      })
    )?.suppressedModules ?? []

    const notice = subscriptionNotice(
      sub && { ...sub, autoRenewActive: isAutoRenewActive(sub, recurringEnabled) },
    )

    return NextResponse.json({
      // Aboneliğe dokunan her işlem (iptal, otomatik yenileme, satın alma) ADMIN'in işi.
      // Aboneliği YÖNETME (yenilemeyi kapatma, iptal) yetkisi hesap yöneticisinindir.
      // Abonelik firma bazına indi ama ödemeyi hesabın sahibi yapıyor
      // (app/api/billing/orders/route.ts); şubeye atanmış bir ADMIN ana firmanın
      // ödemesini yönetememeli — ekranı görür, düğmeleri kapalıdır.
      canManage: access.role === "ADMIN" && (rootId === companyId || isAccountAdmin),
      // Otomatik yenileme ürünü hesapta kapalıysa ekran "kart sakla" vaadi vermemeli.
      recurringEnabled,
      subscription: sub
        ? {
            status: sub.status,
            planId: sub.planId,
            planName: sub.plan?.name ?? null,
            billingCycle: sub.billingCycle,
            amount: sub.amount != null ? Number(sub.amount) : null,
            periodStart: sub.periodStart,
            periodEnd: sub.periodEnd,
            trialEndsAt: sub.trialEndsAt,
            lockedAt: sub.lockedAt,
            autoRenew: sub.autoRenew,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            // "Açık" ile "gerçekten çalışacak" AYRI: token yoksa ya da ürün kapalıysa
            // dönem sonunda kimse tahsilat yapmaz. Ekran ikisini ayrı gösterir.
            autoRenewActive: isAutoRenewActive(sub, recurringEnabled),
            card:
              sub.cardBrand || sub.cardLast4
                ? { brand: sub.cardBrand, last4: sub.cardLast4 }
                : null,
            purchasedModules: sub.purchasedModules,
            isTrialActive: isTrialActive(sub),
            isPaidActive: isPaidActive(sub),
            isInGrace: isInGracePeriod(sub),
          }
        : null,
      notice: notice
        ? {
            kind: notice.kind,
            endsAt: notice.endsAt.toISOString(),
            locksAt: notice.locksAt.toISOString(),
            daysLeft: notice.daysLeft,
            daysUntilLock: notice.daysUntilLock,
            cancelling: notice.cancelling,
          }
        : null,
      // AÇIK modüller = aboneliğin verdikleri ∪ TEMEL (ücretsiz) olanlar. İkinci küme
      // abonelikten bağımsızdır (`applyEntitlements` her uygulamada geri açar), bu yüzden
      // "modülleriniz" listesinde satın alınmışlarla birlikte görünmeleri doğru.
      freeModules: free,
      openModules: applySuppression([...granted, ...free], suppressed),
      quotas,
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        planName: o.planName,
        billingCycle: o.billingCycle,
        amount: Number(o.amount),
        discountCode: o.discountCode,
        discountAmount: Number(o.discountAmount),
        currency: o.currency,
        paidAt: o.paidAt,
        paymentError: o.paymentError,
        createdAt: o.createdAt,
        invoiceNo: o.invoice?.eDocumentNo || o.invoice?.invoiceNo || null,
        invoiceReady: Boolean(o.invoiceId) && o.invoice?.status === "SENT",
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        label: EVENT_LABELS[e.type as SubscriptionEventType] ?? e.type,
        summary: e.summary,
        actor: e.actor,
        createdAt: e.createdAt,
      })),
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("billing subscription error:", error)
    return NextResponse.json({ error: "Abonelik bilgileri okunamadı" }, { status: 500 })
  }
})
