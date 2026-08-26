// PayTR ödeme bildirimi (callback) — TEK giriş noktası ve yönlendirici.
//
// NEDEN TEK: PayTR bildirim URL'si MAĞAZA HESABI BAŞINA TEKTİR, ödeme başına
// ayarlanamaz (get-token'daki merchant_ok_url/fail_url yalnız tarayıcı yönlendirmesidir).
// Kobipo'nun iki ayrı ödeme akışı (kontör yükleme + paket/abonelik) aynı PayTR
// mağazasını kullandığı için panelde hangi adres yazılıysa DİĞERİNİN bildirimleri de
// oraya düşer. Ayrı ayrı uçlar tuttuğumuz sürece:
//
//   panelde /api/kontor/paytr/callback  → paket ödemeleri "sipariş bulunamadı" deyip
//   OK dönüyordu; PayTR bildirimi teslim edilmiş sayıp bir daha denemiyordu →
//   müşterinin parası çekiliyor, sipariş sonsuza dek PENDING_PAYMENT kalıyordu
//   ("Ödemeniz doğrulanıyor…" ekranında takılma).
//
// Çözüm: hangi uca düşerse düşsün bildirim BURADA merchant_oid'e bakılarak doğru akışa
// yönlendirilir. Üç uç (`/api/paytr/callback`, `/api/kontor/paytr/callback`,
// `/api/billing/paytr/callback`) aynı fonksiyonu çağırır; panelde hangisi yazılı olursa
// olsun iki akış da çalışır. Yeni kurulumlarda kanonik adres: `/api/paytr/callback`.

import { prisma } from "@/lib/db/prisma"
import { merchantOidBase, verifyCallbackHash } from "./client"
import { handleKontorNotification } from "@/lib/kontor/paytr-payment"
import { handlePackageNotification } from "@/lib/billing/paytr-payment"

/** PayTR'ın POST ettiği bildirim alanları (form-data). */
export type PaytrNotification = {
  merchantOid: string
  status: string
  totalAmount: string
  paymentType: string
  failedReasonMsg: string
  /**
   * KART SAKLAMA (recurring) alanları — yalnız `recurring_payment=1` ile alınan
   * ödemelerde gelir. Abonelik akışı bunları `Subscription`a yazar; kontör akışı
   * kullanmaz (tek seferlik ödeme).
   *
   * `cardToken` yoksa otomatik yenileme kurulmaz: `runRecurring` token'sız aboneliği
   * atlar. Bu yüzden beklenip gelmediğinde SESSİZ geçilmez (aşağıya bkz.).
   */
  cardToken: string | null
  cardBrand: string | null
  cardLast4: string | null
}

/**
 * Bildirimden kart saklama alanlarını çıkarır.
 *
 * ⚠️ Alan adları PayTR ile TEYİT EDİLECEK (docs/paket-abonelik/PAYTR-RECURRING-KONTROL.md).
 * Bu yüzden isim tahmin etmek yerine ÖĞRENİLİYOR: beklenen alan gelmediğinde bildirimin
 * TÜM anahtarları log'a yazılır, böylece ilk gerçek recurring ödemesinde doğru ad
 * kendiliğinden ortaya çıkar ve tek satırlık bir düzeltmeyle bağlanır.
 */
function readCardFields(form: FormData): Pick<PaytrNotification, "cardToken" | "cardBrand" | "cardLast4"> {
  const str = (k: string) => {
    const v = form.get(k)
    return typeof v === "string" && v.trim() ? v.trim() : null
  }
  return {
    cardToken: str("utoken"),
    cardBrand: str("card_brand") ?? str("card_type"),
    // Yalnız son dört hane saklanır; tam kart numarası HİÇBİR koşulda tutulmaz.
    cardLast4: str("card_no")?.replace(/\D/g, "").slice(-4) || str("last_four") || null,
  }
}

/**
 * Akış sonucu. `"ok"` → PayTR'a OK dönülür (bildirim kapanır).
 * `"retry"` → OK DÖNÜLMEZ; PayTR tekrar dener (ödeme kaydı/aktivasyon yarıda kaldı).
 */
export type NotificationResult = "ok" | "retry"

// PayTR yalnızca gövdede düz "OK" görünce bildirimi tamamlanmış sayar; aksi halde
// tekrar dener. Bu yüzden ödeme kaydedildikten sonra DAİMA "OK" döneriz.
function ok() {
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } })
}

function retryLater() {
  return new Response("error", { status: 500 })
}

/**
 * Bildirimi doğrular ve ilgili akışa yönlendirir.
 *
 * Her iki akış da merchant_oid'i `<orderId>X<deneme-eki>` biçiminde üretir; taban id
 * `merchantOidBase` ile çözülür. Ek taşımayan ESKİ kontör oid'leri (yalın id) de aynı
 * fonksiyondan olduğu gibi geçer — ayraç yoksa string değişmez. cuid'ler yalnız küçük
 * harf/rakam içerdiğinden büyük 'X' ayracı çakışmaz; yine de iki tabloya da bakılır,
 * karar tablodaki KAYDA göre verilir.
 */
export async function handlePaytrNotification(request: Request): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new Response("bad request", { status: 400 })
  }

  const notification: PaytrNotification = {
    merchantOid: String(form.get("merchant_oid") || ""),
    status: String(form.get("status") || ""),
    totalAmount: String(form.get("total_amount") || ""),
    paymentType: String(form.get("payment_type") || ""),
    failedReasonMsg: String(form.get("failed_reason_msg") || ""),
    ...readCardFields(form),
  }
  // Hash yalnız doğrulamada kullanılır; iş kuralı işleyicilerine taşınmaz.
  const hash = String(form.get("hash") || "")

  console.log(
    `[paytr-callback] alındı: merchant_oid=${notification.merchantOid} ` +
      `status=${notification.status} total_amount=${notification.totalAmount}`,
  )

  // Hash doğrulanamazsa OK DÖNME — sahte/bozuk istek reddedilir, gerçekse PayTR tekrar dener.
  if (!notification.merchantOid || !verifyCallbackHash({ ...notification, hash })) {
    console.warn(`[paytr-callback] HASH DOĞRULANAMADI: merchant_oid=${notification.merchantOid}`)
    return new Response("PAYTR notification failed: bad hash", { status: 400 })
  }

  try {
    const packageOrder = await prisma.packageOrder.findUnique({
      where: { id: merchantOidBase(notification.merchantOid) },
    })
    if (packageOrder) {
      // Otomatik yenilemeli bir sipariş kart token'ı olmadan dönerse abonelik kurulur
      // ama BİR DAHA HİÇ tahsilat yapılamaz — `runRecurring` token'sız aboneliği atlar.
      // Sessiz geçilmez: alan adı yanlışsa gelen anahtarlar burada görünür (readCardFields).
      if (packageOrder.autoRenew && notification.status === "success" && !notification.cardToken) {
        console.warn(
          `[paytr-callback] otomatik yenilemeli sipariş ${packageOrder.id} için KART TOKEN'I GELMEDİ — ` +
            `bu abonelik kendiliğinden yenilenemez. Bildirimdeki alanlar: [${[...form.keys()].join(", ")}]`,
        )
      }
      return (await handlePackageNotification(notification, packageOrder)) === "ok" ? ok() : retryLater()
    }

    const kontorOrder = await prisma.kontorOrder.findUnique({
      where: { id: merchantOidBase(notification.merchantOid) },
    })
    if (kontorOrder) {
      return (await handleKontorNotification(notification, kontorOrder)) === "ok" ? ok() : retryLater()
    }

    // Hiçbir tabloda yok: tekrar denemenin anlamı yok, OK ile kapat. Ama SESSİZ GEÇME —
    // eşleşmeyen bildirim, ödemesi alınıp karşılığı verilemeyen sipariş demektir.
    console.warn(
      `[paytr-callback] EŞLEŞEN SİPARİŞ YOK: merchant_oid=${notification.merchantOid} ` +
        `status=${notification.status} — ödeme alınmış olabilir, elle kontrol edin.`,
    )
    return ok()
  } catch (error) {
    console.error("[paytr-callback] işleme hatası:", error)
    // Kayıt/aktivasyon yapılamadıysa OK DÖNME ki PayTR tekrar denesin.
    return retryLater()
  }
}
