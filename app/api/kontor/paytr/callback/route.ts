import { prisma } from "@/lib/db/prisma"
import { verifyCallbackHash } from "@/lib/integrations/paytr/client"
import { loadKontorOrderCredit } from "@/lib/kontor/fulfill"

export const dynamic = "force-dynamic"

// PayTR yalnızca gövdede düz "OK" görünce bildirimi tamamlanmış sayar; aksi halde
// tekrar dener. Bu yüzden ödeme kaydedildikten sonra DAİMA "OK" döneriz.
function ok() {
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } })
}

/**
 * PayTR ödeme bildirimi (sunucu-sunucu, OTURUMSUZ). Tek kimlik doğrulaması HMAC
 * hash'tir. Başarılı ödemede sipariş işaretlenir ve kontör Mysoft'a otomatik yüklenir
 * ([[lib/kontor/fulfill.ts]]). Idempotent: PayTR aynı bildirimi birden çok kez gönderebilir.
 *
 * Bildirim URL'si PayTR mağaza panelinden ayarlanır:
 *   https://<alan-adı>/api/kontor/paytr/callback
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
    `[paytr-callback] alındı: merchant_oid=${merchantOid} status=${status} total_amount=${totalAmount}`,
  )

  // Hash doğrulanamazsa OK DÖNME — sahte/bozuk istek reddedilir, gerçekse PayTR tekrar dener.
  if (!merchantOid || !verifyCallbackHash({ merchantOid, status, totalAmount, hash })) {
    console.warn(`[paytr-callback] HASH DOĞRULANAMADI: merchant_oid=${merchantOid}`)
    return new Response("PAYTR notification failed: bad hash", { status: 400 })
  }

  try {
    const order = await prisma.kontorOrder.findUnique({ where: { id: merchantOid } })
    // Bilinmeyen sipariş: tekrar denemenin anlamı yok, OK ile kapat.
    if (!order) return ok()

    // Idempotency: zaten yüklenmiş ya da ödeme işlenmiş → tekrar işlem yapma.
    if (order.status === "LOADED" || order.paidAt) return ok()

    if (status !== "success") {
      await prisma.kontorOrder.update({
        where: { id: order.id },
        // PENDING_PAYMENT kalır; kullanıcı aynı oid ile tekrar deneyebilir.
        data: { paymentError: failedReasonMsg || "Ödeme başarısız", paymentRef: paymentType || null },
      })
      return ok()
    }

    // Ödeme başarılı → ATOMİK "ödendi" geçişi. Yalnızca paidAt henüz boş olan ilk
    // callback bunu yakalar; eşzamanlı/tekrar gelen bildirimler count=0 alır ve
    // çift yükleme yapılmaz. Tutar bütünlüğü hash ile garanti (taksitte total_amount
    // değişebileceğinden eşitlik zorlanmaz).
    const claim = await prisma.kontorOrder.updateMany({
      where: { id: order.id, paidAt: null, status: { not: "LOADED" } },
      data: { paidAt: new Date(), paymentRef: paymentType || null, paymentError: null },
    })
    if (claim.count === 0) return ok()

    // Mysoft yüklemesi başarısız olsa bile OK döneriz (ödeme alındı; sistem-admin
    // confirm ile tekrar yükleyebilir). Helper hatayı FAILED olarak işler.
    await loadKontorOrderCredit(order.id, { confirmedById: null })
    return ok()
  } catch (error) {
    console.error("kontor paytr callback error:", error)
    // Ödeme kaydı yapılamadıysa OK DÖNME ki PayTR tekrar denesin.
    return new Response("error", { status: 500 })
  }
}
