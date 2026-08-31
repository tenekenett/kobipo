// Paket/abonelik siparişinin PayTR ödeme bildirimi işleyicisi.
//
// Bildirim uçlarından değil, ortak yönlendiriciden çağrılır
// ([[lib/integrations/paytr/notification.ts]]) — hash doğrulaması ve sipariş bulma orada
// yapılır, burada yalnız abonelik akışının iş kuralı vardır.

import type { PackageOrder } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { recordDiscountRedemption } from "@/lib/billing/discount"
import {
  BRANCH_ITEM_KEY,
  COMPANY_ITEM_KEY,
  isBillingCycle,
  type BillingCycle,
} from "@/lib/billing/constants"
import { parsePriceLines } from "@/lib/billing/order-lines"
import { applyEntitlements, periodEndFor } from "@/lib/billing/entitlements"
import { eventDate, logSubscriptionEvent } from "@/lib/billing/events"
import { issueInvoiceQuietly } from "@/lib/invoicing/issue-sales-invoice"
import type { NotificationResult, PaytrNotification } from "@/lib/integrations/paytr/notification"

/**
 * İlk ödemede PayTR'ın sakladığı kart. `token` yoksa otomatik yenileme KURULMAZ:
 * `runRecurring` token'sız aboneliği atlar (bkz. [[lib/billing/jobs.ts]]).
 */
export type SavedCard = {
  token?: string | null
  brand?: string | null
  last4?: string | null
}

/** Karar için gereken sipariş alanları. */
export type OrderSnapshot = {
  resolvedModules: string[]
  branchQuota: number
  companyQuota: number
  billingCycle: string
  /**
   * Kota takviyesinin YENİLEME tutarına ne ekleyeceğini hesaplamak için birim LİSTE
   * fiyatları (siparişin kendi dökümünden, yoksa katalogdan — bkz. `resolveQuotaUnitPrices`).
   * `null` = fiyat çözülemedi; o üründen kota eklendiyse tutara HİÇ dokunulmaz, yanlış
   * bir yenileme tutarı yazmaktansa eski tutar kalsın.
   */
  branchUnitPrice?: number | null
  companyUnitPrice?: number | null
  /**
   * İndirimin YENİLEMELERE de işlediği oran (1 = indirim yenilemeye işlemiyor).
   * `DiscountCode.appliesToRenewals` false ise yenileme liste fiyatından sürer; bu alan
   * olmadan tek seferlik kupon, eklenen kotanın ömür boyu indirimine dönüşürdü.
   */
  renewalPriceRatio?: number
}

/** Karar için gereken mevcut abonelik alanları. */
export type ExistingSubscription = {
  purchasedModules: string[]
  periodEnd: Date | null
  /** Hâlihazırdaki kotalar — takviye bunların ALTINA inemez (bkz. planSubscriptionWrite). */
  branchQuota: number
  companyQuota: number
  /** Yinelenen çekimde kartlan çekilecek tutar (`runRecurring`). Deneme aboneliğinde null. */
  amount: number | null
}

/**
 * Ödeme sonrası aboneliğe ne yazılacağının kararı.
 *  - `quota-top-up`: yalnız kotalar güncellenir; durum/dönem/modüller ve yetkiler korunur.
 *  - `activate`: abonelik ACTIVE yazılır; `applyEntitlements` yalnız modül satın alındığında true.
 */
export type SubscriptionWrite =
  | {
      kind: "quota-top-up"
      branchQuota: number
      companyQuota: number
      /** Yeni yenileme tutarı; `null` = dokunma (fiyat çözülemedi ya da kota artmadı). */
      amount: number | null
    }
  | {
      kind: "activate"
      purchasedModules: string[]
      branchQuota: number
      companyQuota: number
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
 * (yalnız şube/firma kotası) için `purchasedModules = []` yazılıp `applyEntitlements(root, [])`
 * çağrılıyordu; bu da "bir şube daha alayım" diyen müşterinin ana firmasında VE tüm
 * şubelerinde her modülü kapatıyordu. Aynı kural sistem-admin elle kota verme ucunda da
 * geçerli ([[lib/billing/admin.ts]] → `setAccountQuotas`).
 *
 * İkinci kural: **dönem gelecekteyse ONUN ÜSTÜNE eklenir.** Eskiden `max(mevcutBitiş,
 * bugün+periyot)` yazılıyordu; bu, erken yenileyen müşterinin kalan ödenmiş süresini
 * SİLİYORDU — 20 gün kalmışken yıllık yenileyen 20 günü kaybediyor, dokuz ay kalmışken
 * yenileyen dokuz ayı kaybediyordu. Yinelenen çekim ([[lib/billing/jobs.ts]] →
 * `runRecurring`) zaten doğrusunu yapıyordu (`newStart = sub.periodEnd`); aynı soruya
 * iki farklı cevap vardı, tek kurala indirildi.
 *
 * Sonucu: dönem ortasında YÜKSELTME yapan müşteri de kalan süresinin üstüne tam bir
 * periyot alır. Tam periyot bedeli ödediği için doğru olan budur.
 */
function round2(n: number): number {
  return Number(n.toFixed(2))
}

/**
 * Kota takviyesinden sonra aboneliğin YENİLEME tutarı ne olmalı?
 *
 * Kaçak buradaydı: takviye `Subscription.branchQuota`yı yükseltiyor ama `amount`a hiç
 * dokunmuyordu. `runRecurring` her dönem `sub.amount`ı çekiyor — yani modülsüz alınan
 * şube/firma kotası BİR KEZ ödeniyor, sonraki bütün dönemlerde bedava sürüyordu.
 * Canlıda kullanılmış bir yol: `resolvedModules: []` olan siparişler mevcut.
 *
 * Kural: tutar, siparişin tamamı kadar değil **EKLENEN kota kadar** artar. Sipariş
 * (paket seçilmediği için) kotanın TAMAMINI ücretlendirir — hâlihazırda sahip olunan
 * kotayı bir kez daha yenileme tutarına yazmak, her dönem iki kez tahsil etmek olurdu.
 *
 * `null` döner (= tutara dokunma) iki durumda:
 *  - Eklenen kota yok: zaten artacak bir şey yok.
 *  - Eklenen kotanın birim fiyatı çözülemedi: yanlış bir yenileme tutarı yazmaktansa
 *    eski tutar kalsın; olay kaydı ve log durumu görünür kılıyor.
 */
export function topUpRenewalAmount(
  order: OrderSnapshot,
  existing: ExistingSubscription,
  branchQuota: number,
  companyQuota: number,
): number | null {
  const branchAdded = Math.max(0, branchQuota - existing.branchQuota)
  const companyAdded = Math.max(0, companyQuota - existing.companyQuota)
  if (branchAdded === 0 && companyAdded === 0) return null

  // Fiyatı bilinmeyen bir üründen kota eklendiyse hesap YAPILMAZ (kısmî artış, tam
  // artıştan daha yanıltıcı olurdu).
  if (branchAdded > 0 && order.branchUnitPrice == null) return null
  if (companyAdded > 0 && order.companyUnitPrice == null) return null

  const added =
    branchAdded * (order.branchUnitPrice ?? 0) + companyAdded * (order.companyUnitPrice ?? 0)
  if (added <= 0) return null

  return round2((existing.amount ?? 0) + added * (order.renewalPriceRatio ?? 1))
}

export function planSubscriptionWrite(
  order: OrderSnapshot,
  existing: ExistingSubscription | null,
  now: Date,
): SubscriptionWrite {
  const cycle: BillingCycle = isBillingCycle(order.billingCycle) ? order.billingCycle : "MONTHLY"
  const freshPeriodEnd = periodEndFor(cycle, now)
  // Şube VE firma kotası aynı kapıdan geçer: ikisi de modülsüz alınabilir.
  const quotaOnly =
    order.resolvedModules.length === 0 && (order.branchQuota > 0 || order.companyQuota > 0)

  if (quotaOnly) {
    // Mevcut abonelik varsa yalnız kotalara dokun. Yoksa satır aç ama MODÜL VERME
    // (şube/firma ekleme aktif abonelik ister — app/api/companies/route.ts, fail-closed).
    if (existing) {
      // TAKVİYE KOTA DÜŞÜRMEZ. Sipariş iki kotayı da taşır ama müşteri genellikle
      // yalnız birini artırıyor; diğeri formda 0 kalırsa eskisi SİLİNİRDİ. Canlıda
      // oldu: 15 Ağu 2026'da ek firma alan hesabın bir gün önce ödediği şube kotası
      // (branchQuota 1 → 0) yok oldu. Para karşılığı alınmış bir hak, başka bir ürünün
      // satın alınmasıyla kaybolamaz; küçültmenin meşru yolu modül İÇEREN bir
      // siparişle aboneliği baştan yazmaktır (o yol kullanıcıyı ekranda uyarır).
      const branchQuota = Math.max(existing.branchQuota, order.branchQuota)
      const companyQuota = Math.max(existing.companyQuota, order.companyQuota)
      return {
        kind: "quota-top-up",
        branchQuota,
        companyQuota,
        amount: topUpRenewalAmount(order, existing, branchQuota, companyQuota),
      }
    }
    return {
      kind: "activate",
      purchasedModules: [],
      branchQuota: order.branchQuota,
      companyQuota: order.companyQuota,
      periodEnd: freshPeriodEnd,
      applyEntitlements: false,
      droppedModules: [],
    }
  }

  const existingEnd = existing?.periodEnd ?? null
  // Dönem HENÜZ BİTMEDİYSE yeni periyot onun üstüne eklenir; bittiyse bugünden başlar.
  const periodEnd =
    existingEnd && existingEnd.getTime() > now.getTime()
      ? periodEndFor(cycle, existingEnd)
      : freshPeriodEnd
  return {
    kind: "activate",
    purchasedModules: order.resolvedModules,
    branchQuota: order.branchQuota,
    companyQuota: order.companyQuota,
    periodEnd,
    // EMNİYET SÜBABI: modülsüz bir sipariş ASLA yetki yazmaz.
    //
    // Yukarıdaki `quotaOnly` dalı bunu zaten yakalar; bu satır o dal bir gün eksik
    // kalırsa (yeni bir kota türü eklenip koşula yazılmazsa — canlıda tam olarak bu
    // oldu: `companyQuota` bilmeyen bir sürüm siparişi "modül alımı" sanıp
    // `applyEntitlements(root, [])` çağırdı ve hesabın TÜM modüllerini kapattı)
    // hasarı keser. "Hiçbir şey satın alındı" hiçbir zaman "her şeyi kapat" demek
    // değildir; modül kapatmanın meşru yolu, modül İÇEREN bir siparişle küçülmektir
    // (o durum `droppedModules` ile uyarılır).
    applyEntitlements: order.resolvedModules.length > 0,
    droppedModules: (existing?.purchasedModules ?? []).filter(
      (m) => !order.resolvedModules.includes(m),
    ),
  }
}

/**
 * Kota ürünlerinin birim LİSTE fiyatı — önce siparişin kendi dökümünden, yoksa katalogdan.
 *
 * Sıra önemli: `priceLines` müşterinin O AN gördüğü fiyattır ve snapshot'tır; katalog
 * fiyatı sonradan değişmiş olabilir. Döküm yoksa (bu kolon 31 Ağu 2026'da eklendi, eski
 * siparişlerde null) katalog en iyi tahmindir. İkisi de yoksa `null` döner ve yenileme
 * tutarına hiç dokunulmaz.
 */
async function resolveQuotaUnitPrices(
  order: Pick<PackageOrder, "priceLines">,
  cycle: BillingCycle,
): Promise<{ branch: number | null; company: number | null }> {
  const lines = parsePriceLines(order.priceLines)
  const fromLines = (key: string) => {
    const line = lines?.find((l) => l.key === key)
    return line ? line.unitPrice : null
  }

  let branch = fromLines(BRANCH_ITEM_KEY)
  let company = fromLines(COMPANY_ITEM_KEY)
  if (branch == null || company == null) {
    const items = await prisma.pricingItem.findMany({
      where: { key: { in: [BRANCH_ITEM_KEY, COMPANY_ITEM_KEY] } },
      select: { key: true, monthlyPrice: true, yearlyPrice: true },
    })
    const catalogPrice = (key: string) => {
      const item = items.find((i) => i.key === key)
      if (!item) return null
      const v = Number(cycle === "YEARLY" ? item.yearlyPrice : item.monthlyPrice)
      return Number.isFinite(v) ? v : null
    }
    if (branch == null) branch = catalogPrice(BRANCH_ITEM_KEY)
    if (company == null) company = catalogPrice(COMPANY_ITEM_KEY)
  }
  return { branch, company }
}

/**
 * Başarılı bir paket siparişini aktif aboneliğe dönüştürür: hesabın (kök firma) en
 * güncel Subscription'ı varsa günceller, yoksa oluşturur; ardından satın alınan
 * modülleri kök firma + hesabın tüm üyelerine (şubeler ve ek firmalar) uygular
 * ([[lib/billing/entitlements.ts]]).
 *
 * İki mod var:
 *  - **Kota-only** (modülsüz sipariş): yalnız `branchQuota`/`companyQuota` güncellenir.
 *    Durum, dönem, modüller ve tutar snapshot'ına DOKUNULMAZ; `applyEntitlements`
 *    çağrılmaz. Böylece deneme süresi kısalmaz ve açık modüller kapanmaz.
 *  - **Paket/modül alımı**: abonelik ACTIVE'e alınır, modüller yazılır ve uygulanır.
 *    `periodEnd` asla geriye çekilmez (dönem ortasında yükseltme yapan müşteri kalan
 *    ödenmiş süresini kaybetmez).
 */
export async function activateSubscription(order: PackageOrder, card: SavedCard = {}): Promise<void> {
  const cycle: BillingCycle = isBillingCycle(order.billingCycle) ? order.billingCycle : "MONTHLY"
  const now = new Date()

  // İNDİRİM — kullanım kaydı ödeme BAŞARILI olduğunda yazılır (sipariş açılırken
  // değil: yarım kalan sipariş kupon hakkını yemesin). Idempotent.
  let discountAppliesToRenewals = false
  if (order.discountCodeId) {
    const codeRow = await prisma.discountCode.findUnique({
      where: { id: order.discountCodeId },
      select: { appliesToRenewals: true },
    })
    discountAppliesToRenewals = Boolean(codeRow?.appliesToRenewals)
    await recordDiscountRedemption({
      codeId: order.discountCodeId,
      companyId: order.companyId,
      orderKind: "PACKAGE",
      orderId: order.id,
      amount: Number(order.discountAmount ?? 0),
    })
  }

  const existing = await prisma.subscription.findFirst({
    where: { companyId: order.companyId },
    orderBy: { createdAt: "desc" },
  })

  // YENİLEME TUTARI — `Subscription.amount`, saklı kartla çekilecek tutardır
  // ([[lib/billing/jobs.ts]] runRecurring). İndirim yalnız ilk ödemeye aitse abonelik
  // LİSTE tutarıyla yazılır; kod "yenilemelerde de geçerli" ise indirimli tutar kalır.
  // Burada karar verilmezse tek seferlik kupon ömür boyu indirime döner.
  const listAmount = Number(order.amount) + Number(order.discountAmount ?? 0)
  const renewalAmount = discountAppliesToRenewals ? Number(order.amount) : listAmount
  // Kota takviyesi tutarın TAMAMINI değil eklenen kotayı yazar; kuponun yenilemeye
  // işleyip işlemediği oran olarak taşınır.
  const renewalPriceRatio =
    discountAppliesToRenewals && listAmount > 0 ? Number(order.amount) / listAmount : 1

  const quotaUnit = await resolveQuotaUnitPrices(order, cycle)
  const write = planSubscriptionWrite(
    {
      resolvedModules: order.resolvedModules,
      branchQuota: order.branchQuota,
      companyQuota: order.companyQuota,
      billingCycle: order.billingCycle,
      branchUnitPrice: quotaUnit.branch,
      companyUnitPrice: quotaUnit.company,
      renewalPriceRatio,
    },
    existing
      ? {
          purchasedModules: existing.purchasedModules,
          periodEnd: existing.periodEnd,
          branchQuota: existing.branchQuota,
          companyQuota: existing.companyQuota,
          amount: existing.amount != null ? Number(existing.amount) : null,
        }
      : null,
    now,
  )

  if (write.kind === "quota-top-up") {
    // Kota takviyesi — abonelik satırının geri kalanı olduğu gibi kalır.
    await prisma.subscription.update({
      where: { id: existing!.id },
      data: {
        branchQuota: write.branchQuota,
        companyQuota: write.companyQuota,
        provider: "PAYTR",
        paymentRef: order.paymentRef,
        // EKLENEN KOTA YENİLEME TUTARINA DA GİRER. Yazılmazsa müşteri kotayı bir kez
        // öder, sonraki her dönem bedava kullanır (bkz. topUpRenewalAmount).
        ...(write.amount != null ? { amount: write.amount } : {}),
        // SAKLI KART — takviye de gerçek bir PayTR ödemesidir; token'ı atmak,
        // yükselttiğimiz tutarın hiç çekilememesi demek olurdu. `undefined` =
        // "alana dokunma": kart gelmediyse mevcut token korunur.
        ...(card.token ? { providerSubscriptionId: card.token } : {}),
        ...(card.brand ? { cardBrand: card.brand } : {}),
        ...(card.last4 ? { cardLast4: card.last4 } : {}),
      },
    })
    if (write.amount == null) {
      console.warn(
        `[billing-callback] order ${order.id}: kota takviyesinde yenileme tutarı ` +
          `GÜNCELLENMEDİ (eklenen kota yok ya da birim fiyat çözülemedi) — ` +
          `branch=${quotaUnit.branch}, company=${quotaUnit.company}`,
      )
    }
    console.log(
      `[billing-callback] order ${order.id}: kota takviyesi — branchQuota=${write.branchQuota}, ` +
        `companyQuota=${write.companyQuota}, yenileme tutarı=${write.amount ?? "değişmedi"} ` +
        `(modüller/dönem korundu, status=${existing!.status})`,
    )
    await logSubscriptionEvent({
      type: "QUOTA_CHANGED",
      companyId: order.companyId,
      subscriptionId: existing!.id,
      actor: "PAYTR",
      summary:
        `Kota takviyesi — şube ${write.branchQuota}, ek firma ${write.companyQuota}` +
        (write.amount != null ? `, yenileme tutarı ${write.amount}` : ""),
      detail: {
        orderId: order.id,
        branchQuota: write.branchQuota,
        companyQuota: write.companyQuota,
        previousAmount: existing!.amount != null ? Number(existing!.amount) : null,
        renewalAmount: write.amount,
        // Kota almak modül almak DEĞİLDİR; olay kaydı bunu da anlatsın.
        modulesUntouched: true,
      },
    })
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
    companyQuota: write.companyQuota,
    amount: renewalAmount,
    autoRenew: order.autoRenew,
    cancelAtPeriodEnd: false,
    paymentRef: order.paymentRef,
    periodStart: now,
    periodEnd: write.periodEnd,
    // Yeni dönem = temiz sayfa. Uyarı eşiği sıfırlanmazsa bu dönemin "7 gün kaldı"
    // e-postası "zaten daha acilini göndermiştim" diye atlanır; `lockedAt` kalırsa
    // arşiv sayacı ödemiş hesabı saymaya devam eder.
    lastNoticeThreshold: null,
    lastNoticeSentAt: null,
    lockedAt: null,
    // SAKLI KART — yalnız geldiyse yazılır. `undefined` Prisma'da "alana dokunma"
    // demektir: kart bilgisi taşımayan bir sipariş (ör. kota takviyesi ya da recurring
    // kapalıyken alınan ödeme) mevcut token'ı SİLMEMELİ, yoksa çalışan bir otomatik
    // yenileme sessizce ölürdü.
    ...(card.token ? { providerSubscriptionId: card.token } : {}),
    ...(card.brand ? { cardBrand: card.brand } : {}),
    ...(card.last4 ? { cardLast4: card.last4 } : {}),
  }

  const subscriptionId = existing
    ? (await prisma.subscription.update({ where: { id: existing.id }, data, select: { id: true } })).id
    : (
        await prisma.subscription.create({
          data: { companyId: order.companyId, ...data },
          select: { id: true },
        })
      ).id

  if (write.applyEntitlements) {
    await applyEntitlements(order.companyId, write.purchasedModules)
  }

  await logSubscriptionEvent({
    type: "PERIOD_STARTED",
    companyId: order.companyId,
    subscriptionId,
    actor: "PAYTR",
    summary:
      `${cycle === "YEARLY" ? "Yıllık" : "Aylık"} dönem başladı — ` +
      `${eventDate(write.periodEnd)} tarihine kadar` +
      (write.purchasedModules.length > 0 ? ` (${write.purchasedModules.length} modül)` : ""),
    detail: {
      orderId: order.id,
      billingCycle: cycle,
      amount: Number(order.amount),
      modules: write.purchasedModules,
      droppedModules: write.droppedModules,
      branchQuota: write.branchQuota,
      companyQuota: write.companyQuota,
      autoRenew: order.autoRenew,
      cardStored: Boolean(card.token),
    },
  })
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
      // Saklı kart token'ı siparişte de durur: aboneliğe yazım yarıda kalırsa
      // (PayTR tekrar dener) token kaybolmasın.
      ...(p.cardToken ? { recurringToken: p.cardToken } : {}),
    },
  })

  await activateSubscription(paid, {
    token: p.cardToken,
    brand: p.cardBrand,
    last4: p.cardLast4,
  })

  await prisma.packageOrder.update({ where: { id: order.id }, data: { status: "ACTIVE" } })

  // Satış faturası ACTIVE'den SONRA: faturalandırma yan işlemdir, aktifleştirmeyi
  // geciktirmemeli ve hatası PayTR'a "tekrar dene" dedirtmemeli (issueInvoiceQuietly
  // fırlatmaz). Müşteri parasının karşılığını her hâlükârda almış olur.
  await issueInvoiceQuietly({ kind: "PACKAGE", orderId: order.id })
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
  // Siparişte saklı kart token'ı varsa (bildirim gelmiş ama aktivasyon yarıda kalmışsa)
  // elle kurtarmada da aboneliğe taşınır; aksi halde otomatik yenileme kurulmadan kalırdı.
  await activateSubscription(paid, { token: paid.recurringToken })
  return prisma.packageOrder.update({ where: { id: order.id }, data: { status: "ACTIVE" } })
}
