// TAM İNDİRİMLİ (ücretsiz) siparişin karşılanması — PayTR'a hiç gidilmez.
//
// %100 kupon (ya da fiyata eşit sabit tutarlı kupon) tahsil edilecek tutarı sıfıra
// indirir. Sanal POS 0 TL'lik işlem kabul etmez; bu yüzden ödeme adımı ATLANIR ve
// sipariş doğrudan karşılanır. Karşılamanın geri kalanı ödemeli akışla AYNI
// fonksiyonlardan geçer ([[lib/billing/paytr-payment.ts]] activateSubscription,
// [[lib/kontor/fulfill.ts]] loadKontorOrderCredit) — ikinci bir aktivasyon yolu
// yazmak, iki yolun zamanla ayrışması demektir.
//
// Kupon kullanım kaydı da o ortak fonksiyonlardan yazılır; ücretsiz sipariş kotayı
// aynen tüketir, yoksa %100 kupon sınırsız kullanılırdı.

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { activateSubscription } from "@/lib/billing/paytr-payment"
import {
  applyEntitlements,
  getCompanySubscription,
  resolveGrantedModules,
} from "@/lib/billing/entitlements"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { logSubscriptionEvent } from "@/lib/billing/events"
import { moduleLabel } from "@/lib/modules"
import { loadKontorOrderCredit } from "@/lib/kontor/fulfill"
import { issueInvoiceQuietly } from "@/lib/invoicing/issue-sales-invoice"

/**
 * `paymentProvider` damgası. "PAYTR" (sanal POS) ve "MANUAL" (sistem-admin süre verme)
 * ile karışmasın: bu satış GERÇEKTEN yapıldı, bedeli kupon karşıladı.
 */
export const FREE_ORDER_PROVIDER = "DISCOUNT"

/**
 * ÜCRETSİZ PAKET siparişinin `paymentProvider` damgası. `DISCOUNT`tan farkı: orada liste
 * fiyatlı bir satış var ve bedelini kupon karşıladı (faturası kesilir); burada satılan
 * bir bedel YOK — fatura kesilmez, abonelik dönemi açılmaz.
 */
export const FREE_PACKAGE_PROVIDER = "FREE"

export type ClaimFreePackageResult =
  | { ok: true; orderId: string }
  | { ok: false; alreadyClaimed: true }

/**
 * Firmanın ÜCRETSİZ PAKETİNİ karşılar (2026-09-25): damgayı basar, sipariş kaydını
 * yazar ve temel modülleri açar.
 *
 * Neden `settleFreePackageOrder`dan ayrı: o yol LİSTE FİYATLI bir satışın bedelini
 * kuponun karşıladığı durumdur — abonelik dönemi açar, faturası kesilir. Ücretsiz pakette
 * ise satılan bir bedel yoktur ve modüllerin süresi yoktur ("fiyat girilene kadar
 * kullanılır"). Dönem açılsaydı abonelik bitiminde EXPIRED → 30 gün sonra ARŞİV (salt
 * okunur) akışı ücretsiz kullanıcıyı da kilitlerdi.
 *
 * Sipariş kaydı yine yazılır — "bu firma paketi ne zaman, kimle aldı" sorusunun cevabı
 * ve abonelik geçmişindeki satır budur:
 *   - `status: ACTIVE`, `amount: 0`, `paymentProvider: "FREE"`,
 *   - `paidAt: null` — ödeme OLMADI; fatura yeniden deneme işi ([[lib/invoicing/retry-job.ts]])
 *     `paidAt` doluları taradığı için bu sipariş faturalanmaz,
 *   - `resolvedModules: []` — ücretsiz modüller satın alınan kümeye yazılmaz (bkz.
 *     [[lib/billing/pricing.ts]] → `resolvedModules`), hak damgadan akar.
 *
 * Damga ve sipariş tek transaction'da: koşullu `updateMany` (damga boşsa) iki eşzamanlı
 * isteğin ikisinin de sipariş yazmasını engeller. Yetki transaction DIŞINDA uygulanır
 * (`applyEntitlements` kendi bağlantısını kullanır); firmanın aboneliği varsa onun
 * verdikleri korunur.
 */
export async function claimFreePackage(input: {
  companyId: string
  userId: string
  planId: string | null
  planName: string | null
  billingCycle: string
  priceLines: Prisma.InputJsonValue | null
}): Promise<ClaimFreePackageResult> {
  const order = await prisma.$transaction(async (tx) => {
    const stamped = await tx.company.updateMany({
      where: { id: input.companyId, freeModulesClaimedAt: null },
      data: { freeModulesClaimedAt: new Date() },
    })
    if (stamped.count === 0) return null
    return tx.packageOrder.create({
      data: {
        companyId: input.companyId,
        planId: input.planId,
        planName: input.planName,
        selectedModules: [],
        resolvedModules: [],
        branchQuota: 0,
        companyQuota: 0,
        billingCycle: input.billingCycle,
        amount: 0,
        ...(input.priceLines != null ? { priceLines: input.priceLines } : {}),
        currency: "TRY",
        autoRenew: false,
        status: "ACTIVE",
        paymentProvider: FREE_PACKAGE_PROVIDER,
        paidAt: null,
        createdById: input.userId,
      },
      select: { id: true },
    })
  })
  if (!order) return { ok: false, alreadyClaimed: true }

  const sub = await getCompanySubscription(input.companyId)
  await applyEntitlements(input.companyId, resolveGrantedModules(sub))

  const free = await getFreeModuleKeys()
  await logSubscriptionEvent({
    type: "MODULES_CHANGED",
    companyId: input.companyId,
    subscriptionId: sub?.id ?? null,
    actor: "USER",
    actorUserId: input.userId,
    summary:
      "Ücretsiz paket etkinleştirildi" +
      (free.length > 0 ? ` — ${free.map(moduleLabel).join(", ")}` : ""),
    detail: { orderId: order.id, freeModules: free },
  })

  return { ok: true, orderId: order.id }
}

/** Tutar sıfır mı — kuruş artığı taşıyan Decimal'lere karşı toleranslı. */
export function isFreeAmount(amount: unknown): boolean {
  const n = Number(amount)
  return Number.isFinite(n) && n <= 0
}

/**
 * Ücretsiz PAKET/ABONELİK siparişini karşılar: ödendi işaretler, aboneliği uygular,
 * siparişi ACTIVE'e alır ve faturasını keser.
 *
 * Sıra ödemeli akışla aynı: durum ACTIVE en SON yazılır (tamamlanma işareti), böylece
 * aktivasyon yarıda kalırsa sipariş ACTIVE görünmez. Idempotent — ACTIVE sipariş
 * dokunulmadan döner.
 *
 * Kart yoktur, dolayısıyla otomatik yenileme KURULMAZ: `runRecurring` token'sız
 * aboneliği atlar ve dönem sonunda abonelik normal şekilde biter. Kuponun yalnız ilk
 * ödemeye ait olduğu durumda `Subscription.amount` zaten LİSTE tutarıyla yazılır
 * ([[lib/billing/paytr-payment.ts]]).
 */
export async function settleFreePackageOrder(orderId: string): Promise<void> {
  const order = await prisma.packageOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new Error("Sipariş bulunamadı")
  if (order.status === "ACTIVE") return

  // FAIL-CLOSED: ücretli bir sipariş bu kapıdan bedavaya aktifleşmesin. Buraya yalnız
  // sunucunun kendi hesapladığı payable = 0 ile gelinir; yine de doğrulanır.
  if (!isFreeAmount(order.amount)) {
    throw new Error("Bu sipariş ücretsiz değil; ödeme alınmalı")
  }

  const paid = await prisma.packageOrder.update({
    where: { id: order.id },
    data: {
      paidAt: order.paidAt ?? new Date(),
      paymentProvider: FREE_ORDER_PROVIDER,
      paymentError: null,
    },
  })

  await activateSubscription(paid)
  await prisma.packageOrder.update({ where: { id: order.id }, data: { status: "ACTIVE" } })

  // Fatura ACTIVE'den SONRA ve sessiz: faturalandırma yan işlemdir, aktivasyonu
  // geciktirmemeli. 0 TL'lik belge liste fiyatı + tam iskonto olarak kesilir
  // ([[lib/invoicing/issue-sales-invoice.ts]]).
  await issueInvoiceQuietly({ kind: "PACKAGE", orderId: order.id })
}

/**
 * Ücretsiz KONTÖR siparişini karşılar: ödendi işaretler, kontörü Mysoft'a yükler ve
 * yükleme başarılıysa faturasını keser.
 *
 * "Ödendi" geçişi ATOMİK (`updateMany` + `paidAt: null` koşulu): eşzamanlı ikinci bir
 * istek count=0 alır ve kontör iki kez yüklenmez. Fatura yalnız yükleme başarılıysa
 * kesilir — ödemeli akışın gerekçesi burada da geçerli ([[lib/kontor/paytr-payment.ts]]).
 */
export async function settleFreeKontorOrder(
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const order = await prisma.kontorOrder.findUnique({ where: { id: orderId } })
  if (!order) throw new Error("Sipariş bulunamadı")
  if (order.status === "LOADED") return { ok: true }

  if (!isFreeAmount(order.totalPrice)) {
    throw new Error("Bu sipariş ücretsiz değil; ödeme alınmalı")
  }

  const claim = await prisma.kontorOrder.updateMany({
    where: { id: order.id, paidAt: null, status: { not: "LOADED" } },
    data: {
      paidAt: new Date(),
      paymentProvider: FREE_ORDER_PROVIDER,
      paymentError: null,
    },
  })
  if (claim.count === 0) return { ok: true }

  const load = await loadKontorOrderCredit(order.id, { confirmedById: null })
  if (!load.ok) {
    console.warn(
      `[faturalandirma] Ücretsiz kontör siparişi ${order.id} yüklenemediği için ` +
        `faturalanmadı — sistem-admin panelinden tekrar yükleyin.`,
    )
    return { ok: false, error: load.error }
  }

  await issueInvoiceQuietly({ kind: "KONTOR", orderId: order.id })
  return { ok: true }
}
