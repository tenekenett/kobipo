// Kontör siparişinin PayTR ödeme bildirimi işleyicisi.
//
// Bildirim uçlarından değil, ortak yönlendiriciden çağrılır
// ([[lib/integrations/paytr/notification.ts]]) — hash doğrulaması ve sipariş bulma orada
// yapılır, burada yalnız kontör akışının iş kuralı vardır.

import type { KontorOrder } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { loadKontorOrderCredit } from "@/lib/kontor/fulfill"
import type { NotificationResult, PaytrNotification } from "@/lib/integrations/paytr/notification"

/**
 * Başarılı ödemede siparişi "ödendi" işaretler ve kontörü Mysoft'a yükler
 * ([[lib/kontor/fulfill.ts]]). Idempotent: PayTR aynı bildirimi birden çok kez gönderebilir.
 */
export async function handleKontorNotification(
  p: PaytrNotification,
  order: KontorOrder,
): Promise<NotificationResult> {
  // Idempotency: zaten yüklenmiş ya da ödeme işlenmiş → tekrar işlem yapma.
  if (order.status === "LOADED" || order.paidAt) return "ok"

  if (p.status !== "success") {
    await prisma.kontorOrder.update({
      where: { id: order.id },
      // PENDING_PAYMENT kalır; kullanıcı aynı oid ile tekrar deneyebilir.
      data: { paymentError: p.failedReasonMsg || "Ödeme başarısız", paymentRef: p.paymentType || null },
    })
    return "ok"
  }

  // Ödeme başarılı → ATOMİK "ödendi" geçişi. Yalnızca paidAt henüz boş olan ilk
  // callback bunu yakalar; eşzamanlı/tekrar gelen bildirimler count=0 alır ve
  // çift yükleme yapılmaz. Tutar bütünlüğü hash ile garanti (taksitte total_amount
  // değişebileceğinden eşitlik zorlanmaz).
  const claim = await prisma.kontorOrder.updateMany({
    where: { id: order.id, paidAt: null, status: { not: "LOADED" } },
    data: { paidAt: new Date(), paymentRef: p.paymentType || null, paymentError: null },
  })
  if (claim.count === 0) return "ok"

  // Mysoft yüklemesi başarısız olsa bile OK döneriz (ödeme alındı; sistem-admin
  // confirm ile tekrar yükleyebilir). Helper hatayı FAILED olarak işler.
  await loadKontorOrderCredit(order.id, { confirmedById: null })
  return "ok"
}
