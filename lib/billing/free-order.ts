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

import { prisma } from "@/lib/db/prisma"
import { activateSubscription } from "@/lib/billing/paytr-payment"
import { loadKontorOrderCredit } from "@/lib/kontor/fulfill"
import { issueInvoiceQuietly } from "@/lib/invoicing/issue-sales-invoice"

/**
 * `paymentProvider` damgası. "PAYTR" (sanal POS) ve "MANUAL" (sistem-admin süre verme)
 * ile karışmasın: bu satış GERÇEKTEN yapıldı, bedeli kupon karşıladı.
 */
export const FREE_ORDER_PROVIDER = "DISCOUNT"

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
