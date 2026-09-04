// Sistem-admin abonelik/sipariş yönetimi için yardımcılar. Yalnızca süper-admin uçlarından çağrılır.
import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS } from "@/lib/modules"
import {
  applyEntitlements,
  countAccountBranches,
  countAccountCompanies,
  getAccountCompanyIds,
  resolveAccountRootId,
  resolveGrantedModules,
  setCompanyModules,
} from "@/lib/billing/entitlements"
import { TRIAL_PLAN_CODE } from "@/lib/billing/catalog"
import {
  isBillingCycle,
  MAX_BRANCH_QUOTA,
  MAX_COMPANY_QUOTA,
  type BillingCycle,
} from "@/lib/billing/constants"
import { resolveGrantWindow, type GrantMode } from "@/lib/billing/period"
import { isAutoRenewActive } from "@/lib/billing/notice"
import { isRecurringEnabled } from "@/lib/integrations/paytr/client"
import { eventDate, logSubscriptionEvent } from "@/lib/billing/events"
import { issueInvoiceQuietly } from "@/lib/invoicing/issue-sales-invoice"

export type ResetMode = "trial" | "locked"

export function isResetMode(v: unknown): v is ResetMode {
  return v === "trial" || v === "locked"
}

/** Uçların HTTP durum kodu + koda çevirebildiği bilinen (beklenen) hata. */
export class BillingAdminError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = "BillingAdminError"
  }
}

/** Abonelik oluştururken sahip kullanıcı: mevcut aboneliğin userId'si → yoksa ilk üye. */
async function resolveAccountOwnerUserId(companyId: string): Promise<string | null> {
  const existingSub = await prisma.subscription.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  })
  if (existingSub?.userId) return existingSub.userId
  const uc = await prisma.userCompany.findFirst({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  })
  if (uc?.userId) return uc.userId

  // Abonelik artık ŞUBEDE de açılabiliyor ve şubenin çoğu zaman KENDİ üyesi yoktur
  // (erişim ana firmanın ADMIN'inden gelir, bkz. lib/auth/branch-access.ts). Sahibi
  // hesap kökünden çözmezsek "firmada kullanıcı yok" diye elle süre verilemezdi.
  const rootId = await resolveAccountRootId(companyId)
  if (rootId === companyId) return null
  const rootUc = await prisma.userCompany.findFirst({
    where: { companyId: rootId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  })
  return rootUc?.userId ?? null
}

/** Deneme planı (FREE_1Y) kaydını garanti eder. */
async function upsertTrialPlan() {
  return prisma.plan.upsert({
    where: { code: TRIAL_PLAN_CODE },
    update: {},
    create: {
      code: TRIAL_PLAN_CODE,
      name: "Ucretsiz (1 Yil)",
      monthlyPrice: 0,
      maxUsers: 1,
      maxInvoicesPerMonth: 100,
      isActive: true,
    },
  })
}

/**
 * Bir hesabı (kök firma) test için temiz duruma çeker: sipariş + kullanım sayaçlarını siler ve
 * moda göre aboneliği/modül yetkilerini yeniden kurar. Hesabın tüm üyeleri (şubeler ve ek
 * firmalar) kapsama dahildir.
 *
 * - "trial"  → taze 1 yıllık deneme (TÜM modüller açık; satın alma ekranı denenebilir).
 * - "locked" → deneme/abonelik EXPIRED, ÜCRETLİ modüller kilitli (satın al → açılma akışı
 *              denenebilir). Sistem yöneticisinin TEMEL yaptığı ücretsiz modüller açık
 *              kalır — `applyEntitlements` onları her uygulamada geri koyar; bu doğru
 *              davranıştır, ücretsizlik abonelikten bağımsızdır.
 *
 * reconcile'ın ürettiği gerçek durumla tutarlıdır ([[lib/billing/entitlements.ts]]).
 */
export async function resetAccountBilling(companyId: string, mode: ResetMode) {
  const rootId = await resolveAccountRootId(companyId)
  const scopeIds = await getAccountCompanyIds(rootId)

  const userId = await resolveAccountOwnerUserId(rootId)
  // Elle verilmiş kotalar sıfırlamada kaybolmasın: mevcut şube/firmalar kotanın üstünde
  // kalırsa hesap yeni şube ya da firma açamaz duruma düşerdi.
  const previous = await prisma.subscription.findFirst({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    select: { branchQuota: true, companyQuota: true },
  })
  const previousBranchQuota = previous?.branchQuota ?? 0
  const previousCompanyQuota = previous?.companyQuota ?? 0

  // Ortak temizlik: kullanım sayaçları (hesabın tümü) + siparişler (kökte tutulur) +
  // elle kapatılmış temel modüller. Kapatma bilerek siliniyor: iki kipin de onay metni
  // ("TÜM modüller açılacak" / "kilitlenecek") bilinen bir son durum vaat ediyor, kalan
  // bir kapatma o vaadi sessizce bozardı.
  await prisma.usageLimit.deleteMany({ where: { companyId: { in: scopeIds } } })
  await prisma.packageOrder.deleteMany({ where: { companyId: { in: scopeIds } } })
  await prisma.company.updateMany({
    where: { id: { in: scopeIds } },
    data: { suppressedModules: [] },
  })

  const now = new Date()

  // KAPSAM: sıfırlama hesabın TÜM firmalarına işler ama artık her firmaya KENDİ abonelik
  // satırını yazar — abonelik firma düzeyinde olduğu için yalnız köke yazmak, şubeleri
  // kilitli bırakırdı ve "TÜM modüller açılacak" vaadi tutmazdı.
  if (mode === "trial") {
    if (!userId) throw new Error("Firmada kullanıcı yok; deneme aboneliği oluşturulamadı")
    const trialEndsAt = new Date(now)
    trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1)
    const freePlan = await upsertTrialPlan()
    await prisma.subscription.deleteMany({ where: { companyId: { in: scopeIds } } })
    for (const id of scopeIds) {
      await prisma.subscription.create({
        data: {
          userId,
          companyId: id,
          planId: freePlan.id,
          provider: "NONE",
          status: "TRIAL",
          // KOTA yalnız kökte tutulur: şube/ek firma açma hakkı hesap düzeyindedir ve
          // her firmaya kopyalamak hesaba kaç şube açılabileceğini çoğaltırdı.
          branchQuota: id === rootId ? previousBranchQuota : 0,
          companyQuota: id === rootId ? previousCompanyQuota : 0,
          // Açılan modüller aboneliğe de yazılır: yetkinin kaynağı `purchasedModules`tır
          // ve yalnız `disabledModules` yazan bir override ilk yeniden hesaplamada silinir.
          // (TRIAL durumu tanım gereği modül ÜRETMEZ; bu alan, firma ücretliye geçtiğinde
          // ya da elle ACTIVE'e alındığında override'ın ayakta kalmasını sağlar.)
          purchasedModules: [...MODULE_KEYS],
          trialEndsAt,
          periodStart: now,
          periodEnd: trialEndsAt,
        },
      })
      // Süper-admin override: modülleri elle açar. Deneme durumu KENDİLİĞİNDEN modül
      // vermez (bkz. resolveGrantedModules) — bu satır bilinçli bir demo/destek açmasıdır.
      await applyEntitlements(id, [...MODULE_KEYS])
    }
  } else {
    // locked: mevcut abonelikleri EXPIRED'a çek (tarihleri geçmişe), modülleri kilitle.
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    await prisma.subscription.updateMany({
      where: { companyId: { in: scopeIds } },
      data: { status: "EXPIRED", trialEndsAt: past, periodEnd: past },
    })
    // Satın alınmış hiçbir modül yok → ücretli modüller kilitlenir. Ücretsiz (temel)
    // modülleri `applyEntitlements` kendisi geri açar.
    for (const id of scopeIds) await applyEntitlements(id, [])
  }

  return { rootId, mode, scopeCompanies: scopeIds.length }
}

/**
 * Hesabın (kök firma) ŞUBE ve/veya FİRMA kotasını elle ayarlar — satın alma akışı dışında,
 * destek/demo amaçlı. Kotalar HESAP düzeyindedir ve en güncel abonelik satırında tutulur;
 * şube/firma ekleme kontrolü de bu satırı okur (bkz. app/api/companies/route.ts).
 *
 * İki kota AYRI havuzdur, bu yüzden ikisi de opsiyoneldir: verilmeyen alan olduğu gibi
 * kalır. Tek çağrıda ikisini birden yazmak da mümkündür.
 *
 * Aboneliği olmayan hesapta kota tek başına ETKİSİZDİR (ekleme fail-closed çalışır, aktif
 * abonelik ister). Bu durumda çağıran `createTrialIfMissing` ile açıkça onay vermeli; o
 * zaman 1 yıllık deneme satırı açılır. Modül yetkilerine (disabledModules) DOKUNULMAZ —
 * kota vermek modül açmak değildir.
 */
export async function setAccountQuotas(
  companyId: string,
  quotas: { branchQuota?: number; companyQuota?: number },
  opts: { createTrialIfMissing?: boolean } = {},
) {
  const { branchQuota, companyQuota } = quotas
  if (branchQuota == null && companyQuota == null) {
    throw new BillingAdminError("branchQuota veya companyQuota verilmeli", "NO_QUOTA", 400)
  }
  if (
    branchQuota != null &&
    (!Number.isInteger(branchQuota) || branchQuota < 0 || branchQuota > MAX_BRANCH_QUOTA)
  ) {
    throw new BillingAdminError(
      `Şube kotası 0 ile ${MAX_BRANCH_QUOTA} arasında bir tam sayı olmalı`,
      "INVALID_QUOTA",
      400,
    )
  }
  if (
    companyQuota != null &&
    (!Number.isInteger(companyQuota) || companyQuota < 0 || companyQuota > MAX_COMPANY_QUOTA)
  ) {
    throw new BillingAdminError(
      `Firma kotası 0 ile ${MAX_COMPANY_QUOTA} arasında bir tam sayı olmalı`,
      "INVALID_QUOTA",
      400,
    )
  }

  const rootId = await resolveAccountRootId(companyId)
  const [existing, currentBranches, currentCompanies] = await Promise.all([
    prisma.subscription.findFirst({
      where: { companyId: rootId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    countAccountBranches(rootId),
    countAccountCompanies(rootId),
  ])

  // Verilmeyen kota alanına dokunulmaz (undefined → Prisma alanı atlar).
  const data = {
    ...(branchQuota != null ? { branchQuota } : {}),
    ...(companyQuota != null ? { companyQuota } : {}),
  }

  if (existing) {
    const updated = await prisma.subscription.update({
      where: { id: existing.id },
      data,
      select: { id: true, status: true, branchQuota: true, companyQuota: true },
    })
    return {
      rootId,
      subscriptionId: updated.id,
      status: updated.status,
      branchQuota: updated.branchQuota,
      companyQuota: updated.companyQuota,
      currentBranches,
      currentCompanies,
      createdSubscription: false,
    }
  }

  if (!opts.createTrialIfMissing) {
    throw new BillingAdminError(
      "Hesabın aboneliği yok; kota tek başına etkisiz kalır.",
      "NO_SUBSCRIPTION",
      409,
    )
  }

  const userId = await resolveAccountOwnerUserId(rootId)
  if (!userId) {
    throw new BillingAdminError("Firmada kullanıcı yok; abonelik oluşturulamadı", "NO_USER", 409)
  }

  const now = new Date()
  const trialEndsAt = new Date(now)
  trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1)
  const freePlan = await upsertTrialPlan()
  const created = await prisma.subscription.create({
    data: {
      userId,
      companyId: rootId,
      planId: freePlan.id,
      provider: "NONE",
      status: "TRIAL",
      branchQuota: branchQuota ?? 0,
      companyQuota: companyQuota ?? 0,
      trialEndsAt,
      periodStart: now,
      periodEnd: trialEndsAt,
    },
    select: { id: true, status: true, branchQuota: true, companyQuota: true },
  })

  return {
    rootId,
    subscriptionId: created.id,
    status: created.status,
    branchQuota: created.branchQuota,
    companyQuota: created.companyQuota,
    currentBranches,
    currentCompanies,
    createdSubscription: true,
  }
}

/** Elle süre vermenin girdisi. Süre gün/ay/tarihten TAM OLARAK biriyle verilir. */
export type GrantPeriodInput = {
  companyId: string
  mode: GrantMode
  days?: number | null
  months?: number | null
  untilDate?: Date | string | null
  /** Yeni dönemin periyodu — hoşgörü süresini ve yenileme adımını belirler. */
  billingCycle?: string | null
  /** Verilirse hesabın açık modül seti bununla DEĞİŞTİRİLİR; verilmezse dokunulmaz. */
  modules?: string[] | null
  /** Otomatik yenilemeyi açıkça aç/kapat (hediyede genelde kapatılır). */
  autoRenew?: boolean | null
  /** İşaretliyse `PackageOrder` + otomatik fatura üretilir (havale/elden tahsilat). */
  paymentReceived?: boolean
  /** `paymentReceived` ise zorunlu: tahsil edilen tutar. */
  amount?: number | null
  actorUserId?: string | null
}

/** Elle verilebilecek en yüksek tutar — yanlış girişe karşı emniyet. */
const MAX_GRANT_AMOUNT = 1_000_000

/**
 * Bir hesaba (kök firma) ELLE abonelik süresi verir/uzatır. Süper-admin işi.
 *
 * Neden ayrı bir yol: bugün süre vermenin tek yolu `resetAccountBilling("trial")`, o da
 * hesabın siparişlerini SİLİP taze deneme kuruyor — telafi/hediye için fazla yıkıcı ve
 * ücretli müşteride geçmişi yok ediyor. Bu fonksiyon yalnız dönemi (ve istenirse modül
 * setini) yazar; sipariş ve fatura geçmişine dokunmaz.
 *
 * Yaptıkları:
 * 1. Dönemi `resolveGrantWindow` ile hesaplar ([[lib/billing/period.ts]] — `extend`
 *    dönem gelecekteyse ONDAN uzatır, `set` bugünden yazar).
 * 2. Durumu `ACTIVE` yapar ve **uyarı/kilit damgalarını sıfırlar**
 *    (`lockedAt`, `lastNoticeThreshold`, `lastNoticeSentAt`). Bu şart: yeni dönem temiz
 *    sayfadır, aksi halde "7 gün kaldı" uyarısı "daha acilini göndermiştim" diye atlanır
 *    ve arşiv sayacı süresi uzatılmış hesabı saymaya devam eder.
 * 3. Yetkileri **yeniden uygular**. Yalnız tarihi ileri almak yetmez: `EXPIRED` hesapta
 *    `disabledModules` kilitli kaldığı için müşteri "süresi var ama paneli boş" görür.
 * 4. `paymentReceived` ise `PackageOrder` + otomatik fatura üretir.
 * 5. Her hâlde `MANUAL_GRANT` olayı yazar — elle müdahale iz bırakmadan geçmez. Olay
 *    kimin, ne zaman, neyi değiştirdiğini taşır (`actorUserId`, önceki/sonraki dönem,
 *    modül seti, tutar). SERBEST METİNLİ GEREKÇE ALINMAZ: alan 2026-08-27'de kaldırıldı,
 *    çünkü müşterinin kendi "Abonelik geçmişi" ekranında birebir görünüyordu — iç notlar
 *    için tasarlanmış bir kutu müşteriye açılıyordu. İzin taşıdığı bilgi zaten yapısal.
 *
 * **TUZAK — süre uzatmak yinelenen çekimi durdurmaz.** `provider="PAYTR"` +
 * `autoRenew` + saklı kart üçlüsü kuruluysa `runRecurring` yeni `periodEnd`de kartı
 * yine çeker. Yani "3 ay hediye" verilen müşteriden 3 ay sonra para çekilir. Bunu
 * istemiyorsanız `autoRenew: false` geçin; fonksiyon durumu `warnings` ile de bildirir.
 */
export async function grantAccountPeriod(input: GrantPeriodInput) {
  const cycle: BillingCycle | undefined = isBillingCycle(input.billingCycle)
    ? input.billingCycle
    : undefined
  if (input.billingCycle != null && cycle === undefined) {
    throw new BillingAdminError("Periyot MONTHLY ya da YEARLY olmalı", "INVALID_CYCLE", 400)
  }

  const paymentReceived = input.paymentReceived === true
  const amount = input.amount == null ? null : Number(input.amount)
  if (paymentReceived) {
    if (amount == null || !Number.isFinite(amount) || amount <= 0 || amount > MAX_GRANT_AMOUNT) {
      throw new BillingAdminError(
        `Tahsil edilen tutar 0'dan büyük ve ${MAX_GRANT_AMOUNT} altında olmalı`,
        "INVALID_AMOUNT",
        400,
      )
    }
  }

  // Kapsam FİRMA: abonelik firma düzeyinde olduğu için elle verilen süre de düzenlenen
  // firmaya yazılır. Eskiden hesap köküne yazılıyordu; şubeye süre vermek isteyen
  // yönetici farkında olmadan ana firmayı uzatırdı.
  const targetId = input.companyId
  const sub = await prisma.subscription.findFirst({
    where: { companyId: targetId },
    orderBy: { createdAt: "desc" },
  })

  const now = new Date()
  // Denemede erişim `trialEndsAt` ile yürür, ücretlide `periodEnd` ile. Uzatmanın tabanı
  // hangisi geçerliyse odur; karıştırılırsa deneme hesabı "geçmişten" uzatılır.
  const currentEnd =
    sub == null
      ? null
      : sub.status === "TRIAL"
        ? (sub.trialEndsAt ?? sub.periodEnd)
        : (sub.periodEnd ?? sub.trialEndsAt)

  const resolved = resolveGrantWindow({
    mode: input.mode,
    duration: {
      days: input.days ?? null,
      months: input.months ?? null,
      untilDate: input.untilDate == null ? null : new Date(input.untilDate),
    },
    now,
    currentStart: sub?.periodStart ?? null,
    currentEnd,
  })
  if (!resolved.ok) {
    throw new BillingAdminError(resolved.message, resolved.code, 400)
  }
  const { periodStart, periodEnd, basedOn, addedDays, totalDaysFromNow } = resolved.window

  const previousStatus = sub?.status ?? null
  const previousEnd = currentEnd

  // Yeni dönem = temiz sayfa: kilit damgası ve gönderilmiş uyarı eşiği sıfırlanır.
  const periodData = {
    status: "ACTIVE",
    periodStart,
    periodEnd,
    lockedAt: null,
    lastNoticeThreshold: null,
    lastNoticeSentAt: null,
    ...(cycle ? { billingCycle: cycle } : {}),
    ...(input.autoRenew == null ? {} : { autoRenew: input.autoRenew }),
  }

  let subscriptionId: string
  let createdSubscription = false

  if (sub) {
    const updated = await prisma.subscription.update({
      where: { id: sub.id },
      data: periodData,
      select: { id: true },
    })
    subscriptionId = updated.id
  } else {
    const userId = await resolveAccountOwnerUserId(targetId)
    if (!userId) {
      throw new BillingAdminError("Firmada kullanıcı yok; abonelik oluşturulamadı", "NO_USER", 409)
    }
    const created = await prisma.subscription.create({
      data: {
        userId,
        companyId: targetId,
        provider: "NONE",
        purchasedModules: [],
        ...periodData,
        // Yeni satırda otomatik yenileme KAPALI doğar: elle verilen sürenin arkasında
        // saklı bir kart yok, "açık" yazmak yanıltıcı olurdu.
        autoRenew: input.autoRenew === true,
      },
      select: { id: true },
    })
    subscriptionId = created.id
    createdSubscription = true
  }

  // YETKİLER YENİDEN UYGULANIR. Modül seti verildiyse o yazılır (setCompanyModules hem
  // `purchasedModules` hem `disabledModules` yazar — yalnız birini yazmak yetkiyi ilk
  // yeniden hesaplamada sildirir, bu projede iki kez oldu). Verilmediyse aboneliğin
  // mevcut setiyle kilit AÇILIR.
  if (input.modules != null) {
    await setCompanyModules(targetId, input.modules)
  } else {
    const fresh = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        status: true,
        purchasedModules: true,
        trialEndsAt: true,
        periodEnd: true,
        billingCycle: true,
      },
    })
    await applyEntitlements(targetId, resolveGrantedModules(fresh))
  }

  const after = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      provider: true,
      autoRenew: true,
      cancelAtPeriodEnd: true,
      providerSubscriptionId: true,
      purchasedModules: true,
      planId: true,
      branchQuota: true,
      companyQuota: true,
      billingCycle: true,
    },
  })

  // Tahsilat elden/havale alındıysa mali iz bırak: sipariş + otomatik satış faturası.
  let orderId: string | null = null
  if (paymentReceived && after) {
    try {
      const order = await prisma.packageOrder.create({
        data: {
          companyId: targetId,
          planId: after.planId,
          resolvedModules: after.purchasedModules,
          branchQuota: after.branchQuota,
          companyQuota: after.companyQuota,
          billingCycle: after.billingCycle ?? cycle ?? "MONTHLY",
          amount: amount as number,
          // Elle tahsilatta kalem seçimi yok: yönetici tek bir tutar giriyor. Döküm yine
          // de yazılır ki satın alma geçmişinde "dökümü olmayan para" satırı kalmasın.
          priceLines: [
            {
              key: "manual",
              label: "Elle tahsilat (abonelik süresi)",
              qty: 1,
              unitPrice: amount as number,
              total: amount as number,
            },
          ],
          autoRenew: false,
          status: "ACTIVE",
          // Kart değil: PayTR akışının dışında alınmış bir tahsilat. `isTest` FALSE —
          // gerçek para girdi, belge de gerçek kesilmeli.
          paymentProvider: "MANUAL",
          paidAt: now,
          // Kim elle girdi: destek kaydını siparişten olaya bağlayan tek ip ucu.
          paymentRef: input.actorUserId ? `manual:${input.actorUserId}` : "manual",
          isTest: false,
        },
        select: { id: true },
      })
      orderId = order.id
      await issueInvoiceQuietly({ kind: "PACKAGE", orderId: order.id })
    } catch (error) {
      // Sipariş/fatura üretilemese bile SÜRE VERİLDİ — geri almak müşteriyi kapı
      // dışında bırakırdı. Hata uyarı olarak yukarı taşınır, sessizce yutulmaz.
      console.error(`[billing-grant] elle tahsilat siparişi oluşturulamadı (${targetId}):`, error)
    }
  }

  const warnings: string[] = []
  if (after && isAutoRenewActive(after, isRecurringEnabled())) {
    warnings.push(
      "Bu hesapta saklı kartla otomatik yenileme kurulu: verilen süre bittiğinde kart yeniden çekilecek. Hediye/telafi ise otomatik yenilemeyi kapatın.",
    )
  }
  if (after?.cancelAtPeriodEnd) {
    warnings.push(
      "Abonelikte 'dönem sonunda iptal' işareti duruyor: verilen süre bitince hoşgörüsüz kapanacak.",
    )
  }
  if (input.modules == null && (after?.purchasedModules.length ?? 0) === 0) {
    warnings.push(
      "Hesabın satın alınmış modülü yok — süre verildi ama ücretli modüller açılmadı. Modül seti seçerek tekrar verin.",
    )
  }
  if (paymentReceived && !orderId) {
    warnings.push("Tahsilat siparişi/faturası oluşturulamadı; süre yine de verildi.")
  }

  await logSubscriptionEvent({
    type: "MANUAL_GRANT",
    companyId: targetId,
    subscriptionId,
    actor: "ADMIN",
    actorUserId: input.actorUserId ?? null,
    // Özet MÜŞTERİYE de gösteriliyor ("Abonelik geçmişi", components/billing/
    // my-subscription.tsx) — bu yüzden yalnız olguyu anlatır, iç not taşımaz.
    summary:
      `Elle süre verildi: dönem ${eventDate(previousEnd)} → ${eventDate(periodEnd)} ` +
      `(${input.mode === "extend" ? "uzatma" : "yeniden başlatma"})`,
    detail: {
      mode: input.mode,
      basedOn,
      addedDays,
      totalDaysFromNow,
      previousStatus,
      previousEnd: previousEnd?.toISOString() ?? null,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      billingCycle: cycle ?? null,
      modules: input.modules ?? null,
      autoRenew: input.autoRenew ?? null,
      paymentReceived,
      amount: paymentReceived ? amount : null,
      orderId,
      createdSubscription,
      warnings,
    },
  })

  return {
    // Alan adı `rootId` KALDI (uç ve arayüz onu okuyor) ama artık düzenlenen FİRMA'yı
    // gösteriyor: abonelik firma düzeyinde.
    rootId: targetId,
    subscriptionId,
    createdSubscription,
    previousStatus,
    status: "ACTIVE" as const,
    previousEnd,
    periodStart,
    periodEnd,
    addedDays,
    totalDaysFromNow,
    basedOn,
    orderId,
    warnings,
  }
}
