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
//      EXPIRED'a çeker ve modülleri kilitler. Tahsilattan SONRA koşar ki 2. adımda
//      yenilenen abonelik yanlışlıkla kilitlenmesin.
//   4. runArchive     — kilidin üstünden saklama süresi (30 gün) geçmiş hesapları
//      salt-okunur arşive alır. EN SON koşar: sayacın başlangıcı 3. adımın yazdığı
//      `lockedAt`tir, bugün kilitlenenin süresi bugün dolmaz.
//
// Uçlar bu fonksiyonların ince sarmalayıcısıdır; orkestratör `/api/billing/cron/daily`
// üçünü sırayla çağırır. Böylece sıra kodda garanti olur, cron yapılandırmasında değil.

import { prisma } from "@/lib/db/prisma"
import {
  chargeRecurringPayment,
  isRecurringEnabled,
  PAYTR_RECURRING_NOT_IMPLEMENTED,
} from "@/lib/integrations/paytr/client"
import {
  applyEntitlements,
  getAccountCompanyIds,
  getAccountSubscription,
  periodEndFor,
  resolveGrantedModules,
} from "@/lib/billing/entitlements"
import { isBillingCycle, type BillingCycle } from "@/lib/billing/constants"
import { ARCHIVE_AFTER_DAYS, shouldArchive } from "@/lib/billing/archive"
import {
  DAY_MS,
  isAutoRenewActive,
  NOTICE_WARN_DAYS,
  pendingNoticeThreshold,
  reconcileAction,
  subscriptionNotice,
} from "@/lib/billing/notice"
import { eventDate, logSubscriptionEvents, type SubscriptionEventInput } from "@/lib/billing/events"
import { inheritPriceLines, toJsonPriceLines } from "@/lib/billing/order-lines"
import { issueInvoiceQuietly } from "@/lib/invoicing/issue-sales-invoice"
import { isTestPurchase } from "@/lib/invoicing/config"
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
  /** Uyarılması gereken ama hesabında ADMIN e-postası bulunmayan abonelik sayısı. */
  noAdmin: number
  skipped?: boolean
}

/**
 * Bitişi yaklaşan/geçen aboneliklerin ADMIN'lerine uyarı e-postası atar.
 * Hiçbir durumu DEĞİŞTİRMEZ — yalnız bildirir (ve gönderdiği eşiği damgalar).
 */
export async function notifyExpiring(options: {
  baseUrl: string
  now?: Date
}): Promise<NotifyExpiringResult> {
  const now = options.now ?? new Date()
  const horizon = new Date(now.getTime() + (NOTICE_WARN_DAYS + 1) * DAY_MS)
  const recurringEnabled = isRecurringEnabled()

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
      // Hoşgörü süresi periyoda göre değişir (aylık 7, yıllık 15). Bu alan select'te
      // YOKSA karar varsayılana düşer ve yıllık müşteriye yanlış tarih söylenir.
      billingCycle: true,
      // "Kart saklı, kendiliğinden yenilenecek" hâlinde bitiş uyarısı BASTIRILIR.
      provider: true,
      autoRenew: true,
      providerSubscriptionId: true,
      // Eşik durumu: aynı uyarıyı iki kez göndermemek ve kaçan eşiği yakalamak için.
      lastNoticeThreshold: true,
      company: { select: { id: true, slug: true, name: true } },
    },
    orderBy: { periodEnd: "asc" },
  })

  const messages: { to: string; subject: string; html: string }[] = []
  const stamps: { id: string; threshold: number }[] = []
  let matched = 0
  let noAdmin = 0

  for (const sub of candidates) {
    const notice = subscriptionNotice(
      { ...sub, autoRenewActive: isAutoRenewActive(sub, recurringEnabled) },
      now,
    )
    const threshold = pendingNoticeThreshold(notice, sub)
    if (!notice || threshold == null) continue
    matched++

    // Yenileme yetkisi ADMIN'de; uyarı da onlara gider. Hesabın TAMAMI taranır (kök +
    // şubeler + ek firmalar): abonelik kökte tutulsa da hesabın yöneticisi bir ek firmanın
    // üyelik satırında duruyor olabilir. Yalnız köke bakmak o hesabı sessizce uyarısız
    // bırakırdı — kapsam `canManageCompany` ile aynı eksende tutulur (CLAUDE.md).
    const accountCompanyIds = await getAccountCompanyIds(sub.companyId)
    const admins = await prisma.userCompany.findMany({
      where: { companyId: { in: accountCompanyIds }, role: "ADMIN" },
      select: { user: { select: { email: true, name: true } } },
    })

    const renewUrl = `${options.baseUrl}/ayarlar/abonelik?company=${encodeURIComponent(
      sub.company.slug ?? sub.company.id,
    )}`

    // Aynı kişi hesabın birden çok firmasında ADMIN olabilir; e-posta bir kez gitsin.
    const seen = new Set<string>()
    for (const admin of admins) {
      const email = admin.user?.email
      if (!email || seen.has(email)) continue
      seen.add(email)
      const { subject, html } = subscriptionNoticeEmail({
        kind: notice.kind,
        daysLeft: notice.daysLeft,
        endsAt: notice.endsAt,
        locksAt: notice.locksAt,
        companyName: sub.company.name,
        renewUrl,
        userName: admin.user.name,
      })
      messages.push({ to: email, subject, html })
    }

    if (seen.size === 0) {
      // SESSİZ GEÇME: uyarılması gereken bir hesapta uyarılacak kimse yok. Erişimi
      // kapanacak müşteri hiçbir şey duymadan kapıda kalır; bu elle müdahale ister.
      noAdmin++
      console.warn(
        `[billing-notify] hesapta ADMIN e-postası YOK — uyarı gönderilemedi: ` +
          `company=${sub.companyId} (${sub.company.name}) sub=${sub.id} kind=${notice.kind}`,
      )
      continue
    }

    stamps.push({ id: sub.id, threshold })
  }

  const result = await sendEmailBatch(messages)

  // Eşik damgası YALNIZ gönderim turu bir şey yolladıysa yazılır: sağlayıcı toptan
  // çökerse (sent=0) işaret koymayız ki ertesi gün aynı eşik yeniden denensin.
  if (result.sent > 0 && stamps.length > 0) {
    await Promise.all(
      stamps.map(({ id, threshold }) =>
        prisma.subscription.update({
          where: { id },
          data: { lastNoticeThreshold: threshold, lastNoticeSentAt: now },
        }),
      ),
    )
  }

  return { scanned: candidates.length, matched, noAdmin, ...result }
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
  /** Yenileme için açılıp faturalandırılan sipariş sayısı. */
  invoiced: number
  note?: string
}

/**
 * Başarılı bir yenileme için `PackageOrder` açar ve faturasını keser.
 *
 * Neden gerekli: **yenileme de bir SATIŞTIR.** Yalnız `Subscription.periodEnd`'i ileri
 * almak, parası çekilmiş bir dönemin hiçbir mali izi olmaması demektir — müşteri
 * faturasını göremez, otomatik faturalandırma (REYPO) o geliri hiç görmez.
 *
 * Sipariş `ACTIVE` ve `paidAt` dolu doğar: ödeme zaten alındı, bir ödeme akışı beklemiyor.
 * Kimlik/adres alanları boş bırakılır — fatura kesici bunları firmadan türetir
 * ([[lib/invoicing/issue-sales-invoice.ts]]), böylece müşteri fatura bilgisini
 * güncellediğinde yenilemeler de güncel bilgiyle kesilir.
 *
 * Fırlatmaz: faturalandırma yan işlemdir, başarısız olması yenilemeyi geri almamalı —
 * müşteri parasının karşılığını her hâlükârda almış olur. Faturasız kalan sipariş
 * günlük işin `invoiceRetry` adımında tekrar denenir.
 */
async function recordRenewalOrder(sub: {
  id: string
  companyId: string
  planId: string | null
  purchasedModules: string[]
  branchQuota: number
  companyQuota: number
  amount: unknown
  createdById?: string | null
}, params: { cycle: BillingCycle; paidAt: Date; paymentRef: string | null }): Promise<boolean> {
  try {
    // Kalem dökümü, o tutarı doğuran satın almadan devralınır — katalogdan yeniden
    // hesaplanmaz ([[lib/billing/order-lines.ts]]).
    const priceLines = await inheritPriceLines({
      companyId: sub.companyId,
      billingCycle: params.cycle,
      amount: Number(sub.amount),
    })
    const order = await prisma.packageOrder.create({
      data: {
        companyId: sub.companyId,
        planId: sub.planId,
        resolvedModules: sub.purchasedModules,
        branchQuota: sub.branchQuota,
        companyQuota: sub.companyQuota,
        billingCycle: params.cycle,
        amount: Number(sub.amount),
        priceLines: priceLines ? toJsonPriceLines(priceLines) : undefined,
        autoRenew: true,
        status: "ACTIVE",
        paymentProvider: "PAYTR",
        paidAt: params.paidAt,
        paymentRef: params.paymentRef,
        isTest: isTestPurchase("CARD"),
      },
      select: { id: true },
    })
    await issueInvoiceQuietly({ kind: "PACKAGE", orderId: order.id })
    return true
  } catch (error) {
    console.error(
      `[billing-recurring] yenileme siparişi/faturası oluşturulamadı (sub ${sub.id}):`,
      error,
    )
    return false
  }
}

/**
 * Vadesi gelmiş, otomatik yenilemeli PayTR aboneliklerini saklı kartla yeniden çeker.
 *
 * `PAST_DUE` olanlar da taranır: hoşgörü süresindeki bir abonelik her gün yeniden
 * denenmeli, aksi halde ilk başarısız çekimden sonra bir daha hiç denenmezdi.
 *
 * `PAYTR_RECURRING_ENABLED` kapalıyken hiçbir şey yapılmaz — abonelikler DEĞİŞTİRİLMEZ
 * (bkz. [[lib/integrations/paytr/client.ts]] → `isRecurringEnabled`).
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
      // Yenileme siparişinin snapshot'ı için (bkz. recordRenewalOrder).
      planId: true,
      branchQuota: true,
      companyQuota: true,
      user: { select: { email: true } },
    },
  })

  let renewed = 0
  let failed = 0
  let pending = 0
  let skipped = 0
  let invoiced = 0
  const events: SubscriptionEventInput[] = []

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
        const newEnd = periodEndFor(cycle, newStart)
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: "ACTIVE",
            periodStart: newStart,
            periodEnd: newEnd,
            paymentRef: result.paymentRef ?? null,
            // Yeni dönem = temiz sayfa: uyarı eşiği sıfırlanmazsa bir sonraki dönemin
            // "7 gün kaldı" e-postası "zaten daha acilini göndermiştim" diye atlanır.
            lastNoticeThreshold: null,
            lastNoticeSentAt: null,
            lockedAt: null,
          },
        })
        await applyEntitlements(sub.companyId, sub.purchasedModules)
        renewed++
        events.push({
          type: "RENEWED",
          companyId: sub.companyId,
          subscriptionId: sub.id,
          actor: "PAYTR",
          summary: `Saklı kartla yenilendi — yeni dönem sonu ${eventDate(newEnd)}`,
          detail: {
            billingCycle: cycle,
            amount: Number(sub.amount),
            merchantOid,
            paymentRef: result.paymentRef ?? null,
          },
        })
        // Yenileme de bir SATIŞ: dönemin siparişi açılır ve faturası kesilir.
        // Aboneliğin uzatılmasından SONRA — faturalandırma yan işlemdir ve hatası
        // müşterinin ödediği erişimi geri almamalı.
        if (await recordRenewalOrder(sub, { cycle, paidAt: now, paymentRef: result.paymentRef ?? null })) {
          invoiced++
        }
      } else {
        // Kart reddi vb. → PAST_DUE; hoşgörü süresi dolunca reconcile kilitler.
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } })
        failed++
        events.push({
          type: "RENEWAL_FAILED",
          companyId: sub.companyId,
          subscriptionId: sub.id,
          actor: "PAYTR",
          summary: `Saklı kartla çekim reddedildi${result.failReason ? ` — ${result.failReason}` : ""}`,
          detail: { amount: Number(sub.amount), merchantOid, failReason: result.failReason ?? null },
        })
      }
    } catch (error: any) {
      // Recurring kapalı (NotImplemented) veya geçici hata → durumu DEĞİŞTİRME, tekrar denenecek.
      if (error?.message !== PAYTR_RECURRING_NOT_IMPLEMENTED) {
        console.error(`recurring charge error (sub ${sub.id}):`, error)
      }
      pending++
    }
  }

  await logSubscriptionEvents(events)

  return {
    due: due.length,
    renewed,
    failed,
    pending,
    skipped,
    invoiced,
    note:
      pending > 0
        ? "Bazı çekimler sonuçlanmadı (recurring kapalı ya da PayTR yanıtı belirsiz); o abonelikler değiştirilmeden bırakıldı."
        : skipped > 0
          ? "Saklı kartı olmayan abonelikler atlandı — otomatik yenileme kurulmamış."
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
      // Hoşgörü süresi periyoda göre (aylık 7, yıllık 15). Bu alan select'te YOKSA
      // `reconcileAction` varsayılana düşer ve karar yanlış olur.
      billingCycle: true,
    },
  })

  const toExpire: string[] = []
  const toPastDue: string[] = []
  const expiredRoots = new Set<string>()
  const events: SubscriptionEventInput[] = []

  for (const sub of candidates) {
    // graceDays argümanı VERİLMEZ: `reconcileAction` onu aboneliğin periyodundan türetir.
    const action = reconcileAction(sub, now)
    if (action === "expire") {
      toExpire.push(sub.id)
      expiredRoots.add(sub.companyId)
      events.push({
        type: "EXPIRED",
        companyId: sub.companyId,
        subscriptionId: sub.id,
        summary:
          sub.status === "TRIAL"
            ? `Deneme süresi doldu (${eventDate(sub.trialEndsAt)}) — modüller kilitlendi`
            : `Erişim kapandı — ödenmiş dönem ${eventDate(sub.periodEnd)} tarihinde bitmişti`,
        detail: { previousStatus: sub.status, periodEnd: sub.periodEnd?.toISOString() ?? null },
      })
    } else if (action === "past_due") {
      toPastDue.push(sub.id)
      events.push({
        type: "GRACE_STARTED",
        companyId: sub.companyId,
        subscriptionId: sub.id,
        summary: `Dönem ${eventDate(sub.periodEnd)} tarihinde bitti, ödeme alınamadı — hoşgörü başladı`,
        detail: { previousStatus: sub.status, billingCycle: sub.billingCycle },
      })
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
      // `lockedAt` = erişimin GERÇEKTEN kapandığı an. Arşiv sayacı buradan işler;
      // `periodEnd`'den saymak hoşgörüde geçen günleri iki kez saymak olurdu.
      data: { status: "EXPIRED", lockedAt: now },
    })
  }

  // Kilitlenen her hesap kökü için modülleri yeniden çöz. En güncel abonelik hâlâ
  // aktifse (ör. eski deneme bitti ama yeni ücretli sub var) modüller açık kalır.
  for (const root of expiredRoots) {
    const latest = await getAccountSubscription(root)
    await applyEntitlements(root, resolveGrantedModules(latest, now))
  }

  await logSubscriptionEvents(events)

  return {
    scanned: candidates.length,
    pastDue: toPastDue.length,
    expired: toExpire.length,
    accountsReconciled: expiredRoots.size,
  }
}

// ---------------------------------------------------------------------------
// 4. Arşiv kademesi
// ---------------------------------------------------------------------------

export type ArchiveResult = {
  scanned: number
  /** Arşive alınan HESAP sayısı (kök firma). */
  archivedAccounts: number
  /** Damgalanan firma sayısı — kök + şubeler + ek firmalar. */
  archivedCompanies: number
}

/**
 * Kilitlenmesinin üstünden saklama süresi geçmiş hesapları SALT-OKUNUR arşive alır.
 *
 * Sayaç `lockedAt`ten işler ([[lib/billing/archive.ts]]): erişimin gerçekten kapandığı
 * an odur, `periodEnd` değil — aradan hoşgörü geçtiği için periodEnd'den saymak o
 * günleri iki kez saymak olurdu.
 *
 * Damga hesabın TÜM üyelerine yazılır (`disabledModules` deseni): kapı her istekte
 * kullanıcı bağlamından okunuyor, üye başına ek sorgu istemesin.
 *
 * **Silme yok.** Arşiv, verinin saklandığı ve indirilebildiği bir hâldir; fatura ve
 * defter kayıtları VUK gereği durmak zorunda. Reconcile'dan SONRA koşar: aynı gecede
 * kilitlenen bir hesabın sayacı bugün başlar, bugün dolmaz.
 *
 * Idempotent: zaten damgalı firmalar sorguya girmez.
 */
export async function runArchive(options: { now?: Date } = {}): Promise<ArchiveResult> {
  const now = options.now ?? new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS)

  const candidates = await prisma.subscription.findMany({
    where: { status: "EXPIRED", lockedAt: { not: null, lte: cutoff } },
    select: { id: true, companyId: true, lockedAt: true, status: true },
  })

  let archivedAccounts = 0
  let archivedCompanies = 0
  const events: SubscriptionEventInput[] = []

  for (const sub of candidates) {
    // Saf karar; sorgu zaten süzüyor ama kural TEK yerde kalsın.
    if (!shouldArchive(sub, now)) continue

    // Abonelik satırı eskimiş olabilir: hesabın EN GÜNCEL aboneliği aktifse (müşteri
    // bu arada yeni dönem başlattı) arşivlenmemeli. Bunu sormadan damgalamak, ödeyen
    // müşteriyi salt-okunura düşürürdü.
    const latest = await getAccountSubscription(sub.companyId)
    if (!latest || latest.status !== "EXPIRED") continue

    const scopeIds = await getAccountCompanyIds(sub.companyId)
    const stamped = await prisma.company.updateMany({
      where: { id: { in: scopeIds }, archivedAt: null },
      data: { archivedAt: now },
    })
    if (stamped.count === 0) continue

    archivedAccounts += 1
    archivedCompanies += stamped.count
    events.push({
      type: "ARCHIVED",
      companyId: sub.companyId,
      subscriptionId: sub.id,
      summary:
        `Erişim ${eventDate(sub.lockedAt)} tarihinde kapanmıştı; ${ARCHIVE_AFTER_DAYS} gün sonra ` +
        `hesap salt-okunur arşive alındı (${stamped.count} firma). Veriler silinmedi.`,
      detail: {
        lockedAt: sub.lockedAt?.toISOString() ?? null,
        archivedAt: now.toISOString(),
        companies: stamped.count,
      },
    })
  }

  await logSubscriptionEvents(events)

  return { scanned: candidates.length, archivedAccounts, archivedCompanies }
}
