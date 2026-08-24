// Kontör siparişinin PayTR ödeme bildirimi işleyicisi.
//
// Bildirim uçlarından değil, ortak yönlendiriciden çağrılır
// ([[lib/integrations/paytr/notification.ts]]) — hash doğrulaması ve sipariş bulma orada
// yapılır, burada yalnız kontör akışının iş kuralı vardır.

import type { KontorOrder } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { loadKontorOrderCredit } from "@/lib/kontor/fulfill"
import { issueInvoiceQuietly } from "@/lib/invoicing/issue-sales-invoice"
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
  if (order.status === "LOADED" || order.paidAt) {
    // Ama SESSİZ geçme: merchant_oid artık deneme başına benzersiz üretildiği için
    // ([[lib/integrations/paytr/client.ts]] newMerchantOid) PayTR aynı siparişin İKİNCİ
    // bir ödeme oturumunu da kabul edebilir (ör. iki sekmede açık kalan ödeme ekranı).
    // Kontör tek kez yüklenir — fazladan çekim varsa iade gerekir, o yüzden log'a düşür.
    if (p.status === "success") {
      console.warn(
        `[paytr-callback] kontör siparişi ${order.id} zaten ödenmiş/yüklenmişken yeni ` +
          `BAŞARILI bildirim geldi (merchant_oid=${p.merchantOid}) — mükerrer çekim ` +
          `olabilir, PayTR panelinden kontrol edin.`,
      )
    }
    return "ok"
  }

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
  const load = await loadKontorOrderCredit(order.id, { confirmedById: null })

  // Satış faturası YALNIZ yükleme başarılıysa kesilir.
  //
  // NEDEN sırası böyle: hizmetin ifası kontörün yüklenmesidir. Yükleme başarısızken
  // belge kesersek, iptal etmemiz gereken gerçek bir e-belge doğar — ve e-Arşiv iptali
  // yalnız 24 saat içinde mümkündür ([[app/api/e-donusum/invoices/[id]/cancel]]),
  // e-Fatura'da hiç mümkün değildir (iade faturası gerekir). Oysa FAILED yüklemelerin
  // çoğu geçicidir ve sistem-admin "Onayla & Yükle" ile tekrar dener; o deneme
  // başarılı olunca fatura oradan kesilir. Kalıcı başarısızlıkta ise sipariş
  // faturasız kalır — sistem-admin ya tekrar yükler ya iade eder; hiçbir durumda
  // iptal edilmesi gereken bir belge üretmiş olmayız.
  if (load.ok) {
    await issueInvoiceQuietly({ kind: "KONTOR", orderId: order.id })
  } else {
    console.warn(
      `[faturalandirma] Kontör siparişi ${order.id} yüklenemediği için faturalanmadı — ` +
        `ödeme ALINDI, sistem-admin panelinden tekrar yükleyin.`,
    )
  }
  return "ok"
}
