import crypto from "node:crypto"

/**
 * PayTR iFrame API istemcisi.
 *
 * ÖNEMLİ: PayTR kimliği müşteri başına DEĞİL — uygulama geneli TEK Kobipo merchant
 * hesabıdır (env'de saklanır), tıpkı Mysoft bayi kimliği gibi ([[partner.ts]]).
 * Kontör kart ödemeleri bu hesapla alınır.
 *
 * Akış: createPaymentToken → istemci iframe gömer → PayTR ödeme sonrası sunucu-sunucu
 * bildirim (callback) POST eder → verifyCallbackHash ile doğrulanır.
 */

const PAYTR_GET_TOKEN_URL = "https://www.paytr.com/odeme/api/get-token"
// PayTR iFrame gömme URL'i (resmi dok: /odeme/guvenli/{token}).
export const PAYTR_IFRAME_BASE = "https://www.paytr.com/odeme/guvenli/"

export const PAYTR_NOT_CONFIGURED_ERROR =
  "PayTR sanal POS yapılandırılmamış. Sunucuda PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY ve PAYTR_MERCHANT_SALT ortam değişkenlerini ayarlayın."

export type PaytrCredentials = {
  merchantId: string
  merchantKey: string
  merchantSalt: string
  /** "1" = test (sandbox), "0" = canlı. Varsayılan: test. */
  testMode: "0" | "1"
}

export function getPaytrCredentials(): PaytrCredentials | null {
  const merchantId = process.env.PAYTR_MERCHANT_ID?.trim()
  const merchantKey = process.env.PAYTR_MERCHANT_KEY?.trim()
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT?.trim()
  if (!merchantId || !merchantKey || !merchantSalt) return null
  // Açıkça "0" denmedikçe test modunda kal (yanlışlıkla canlı çekim olmasın).
  const testMode: "0" | "1" = process.env.PAYTR_TEST_MODE?.trim() === "0" ? "0" : "1"
  return { merchantId, merchantKey, merchantSalt, testMode }
}

export function isPaytrEnabled(): boolean {
  return getPaytrCredentials() !== null
}

/**
 * Yinelenen (recurring) çekim CANLI mı?
 *
 * Ayrı bir bayrak, çünkü PayTR mağazasında "Tekrarlayan Ödeme" ürünü ayrıca açılır ve
 * açık olmadan yapılan çekim isteği hata döner. Bayrak kapalıyken:
 *   - ilk ödemede karta "sakla" işareti KONMAZ (`recurring_payment` gönderilmez),
 *   - günlük iş vadesi gelen aboneliğe DOKUNMAZ (durum değişmez, tekrar denenir).
 * Böylece ürün açılmadan sistem yanlış bir şey yapmaz; açıldığında tek env ile devreye girer.
 *
 * Açıkça "1" denmedikçe kapalı — yanlış yapılandırmada para hareketi başlamasın.
 */
export function isRecurringEnabled(): boolean {
  return isPaytrEnabled() && process.env.PAYTR_RECURRING_ENABLED?.trim() === "1"
}

type CreateTokenParams = {
  merchantOid: string
  email: string
  /** Kuruş cinsinden tam sayı (ör. 100.00 TL → 10000). */
  paymentAmount: number
  userIp: string
  /** [ad, fiyat(string), adet] üçlüleri. */
  userBasket: Array<[string, string, number]>
  userName: string
  userAddress: string
  userPhone: string
  okUrl: string
  failUrl: string
  /** 0 = taksite izin ver (varsayılan), 1 = tek çekim. */
  noInstallment?: 0 | 1
  maxInstallment?: number
  currency?: string
  timeoutLimitMinutes?: number
  /**
   * true → PayTR'a "recurring_payment=1" gönderir: ödeme başarılıysa kart saklanır ve
   * sonraki dönemler "Tekrarlayan Ödeme" API'siyle çekilebilir (abonelik). Hash string'ini
   * ETKİLEMEZ (dokümante alanların dışında). PayTR hesabında recurring özelliği açık olmalı.
   */
  recurringPayment?: boolean
}

/**
 * PayTR merchant_oid HER ödeme denemesi için BENZERSİZ olmalıdır: aynı oid ile ikinci kez
 * token istenirse PayTR "merchant_oid daha önce kullanılmış" hatası verir (sayfa yenileme,
 * dev'de çift mount, "tekrar dene", ödeme dönüşü — hepsi token isteğini tekrar tetikler).
 * Bu yüzden sipariş id'sini taşıyan ama denemeye özel bir oid üretiriz:
 *   `<orderId>X<base36 zaman><rastgele>`
 * Ayraç büyük harf 'X'; sipariş id'leri cuid'dir (yalnız küçük harf 0-9a-z) → çakışmaz.
 * Yalnız alfanumerik (PayTR şartı) ve < 64 karakter. Callback `merchantOidBase` ile geri çözer.
 */
export function newMerchantOid(orderId: string): string {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  return `${orderId}X${suffix}`
}

/**
 * merchant_oid'den sipariş id'sini geri çözer. Hem yeni biçimle (`<id>X<suffix>`) hem de
 * eski/kontör biçimiyle (merchant_oid == bare id) uyumludur: ayraç yoksa string olduğu gibi döner.
 */
export function merchantOidBase(merchantOid: string): string {
  return merchantOid.split("X")[0]
}

/**
 * PayTR get-token: HMAC-SHA256 imzasıyla ödeme token'ı üretir. Başarısızsa
 * PayTR'ın döndüğü `reason` ile fırlatır.
 */
export async function createPaymentToken(params: CreateTokenParams): Promise<{ token: string }> {
  const creds = getPaytrCredentials()
  if (!creds) throw new Error(PAYTR_NOT_CONFIGURED_ERROR)

  const { merchantId, merchantKey, merchantSalt, testMode } = creds
  const noInstallment = params.noInstallment ?? 0
  const maxInstallment = params.maxInstallment ?? 0
  const currency = params.currency ?? "TL"
  const userBasket = Buffer.from(JSON.stringify(params.userBasket)).toString("base64")

  // hash_str = merchant_id + user_ip + merchant_oid + email + payment_amount +
  //            user_basket + no_installment + max_installment + currency + test_mode
  // paytr_token = base64( HMAC_SHA256( hash_str + merchant_salt, merchant_key ) )
  const hashStr =
    `${merchantId}${params.userIp}${params.merchantOid}${params.email}` +
    `${params.paymentAmount}${userBasket}${noInstallment}${maxInstallment}${currency}${testMode}`
  const paytrToken = crypto
    .createHmac("sha256", merchantKey)
    .update(hashStr + merchantSalt)
    .digest("base64")

  const form = new URLSearchParams({
    merchant_id: merchantId,
    user_ip: params.userIp,
    merchant_oid: params.merchantOid,
    email: params.email,
    payment_amount: String(params.paymentAmount),
    paytr_token: paytrToken,
    user_basket: userBasket,
    debug_on: testMode === "1" ? "1" : "0",
    no_installment: String(noInstallment),
    max_installment: String(maxInstallment),
    user_name: params.userName,
    user_address: params.userAddress,
    user_phone: params.userPhone,
    merchant_ok_url: params.okUrl,
    merchant_fail_url: params.failUrl,
    timeout_limit: String(params.timeoutLimitMinutes ?? 30),
    currency,
    test_mode: testMode,
    lang: "tr",
  })

  // KART SAKLAMA — PayTR bu işareti gördüğünde ödeme başarılıysa kartı saklar ve
  // bildirimde bir kart token'ı döndürür; sonraki dönemler `chargeRecurringPayment`
  // ile çekilir. Hash string'ini ETKİLEMEZ (yukarıdaki hashStr'de yer almaz).
  //
  // `isRecurringEnabled()` şartı önemli: PayTR hesabında "Tekrarlayan Ödeme" ürünü açık
  // değilken bu alanı göndermek ödeme isteğini reddettirir. Yani ürün açılana kadar
  // normal ödeme akışı hiç etkilenmez.
  if (params.recurringPayment && isRecurringEnabled()) {
    form.set("recurring_payment", "1")
  }

  const res = await fetch(PAYTR_GET_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })
  const data = (await res.json().catch(() => null)) as
    | { status?: string; token?: string; reason?: string }
    | null
  if (!data || data.status !== "success" || !data.token) {
    throw new Error(data?.reason || `PayTR token alınamadı (HTTP ${res.status})`)
  }
  return { token: String(data.token) }
}

export const PAYTR_RECURRING_NOT_IMPLEMENTED =
  "PayTR yinelenen (recurring) çekim devrede değil (PAYTR_RECURRING_ENABLED=1 değil). İlk dönem ödemesi ve tüm enforcement çalışır; otomatik yenileme için PayTR hesabında 'Tekrarlayan Ödeme' ürünü açılıp bu bayrak verilmelidir."

/** PayTR beklenmedik bir gövde döndürdü — çekimin olup olmadığı BİLİNMİYOR. */
export const PAYTR_RECURRING_UNKNOWN_RESPONSE = "PayTR yinelenen çekim yanıtı tanınmadı"

/**
 * Yinelenen çekim ucu.
 *
 * ⚠️ **PayTR ile TEYİT EDİLECEK** — bkz. docs/paket-abonelik/PAYTR-RECURRING-KONTROL.md.
 * Kod değişikliği gerekmeden düzeltilebilsin diye env'den geçersiz kılınabilir.
 */
const PAYTR_RECURRING_URL =
  process.env.PAYTR_RECURRING_URL?.trim() || "https://www.paytr.com/odeme/api/recurring-payment"

export type RecurringChargeInput = {
  /** Bu döneme özel yeni merchant_oid (idempotency + PayTR kaydı için benzersiz). */
  merchantOid: string
  /** İlk ödemede saklanan kartı temsil eden PayTR token'ı (Subscription.providerSubscriptionId). */
  cardToken: string
  /** Kuruş cinsinden tam sayı. */
  paymentAmount: number
  email: string
  userIp: string
  currency?: string
}

export type RecurringChargeResult = {
  success: boolean
  /** PayTR işlem referansı / ödeme tipi (başarıda). */
  paymentRef?: string
  /** Başarısızsa PayTR'ın döndürdüğü neden. */
  failReason?: string
}

/**
 * Saklı kartla yinelenen (recurring) çekim.
 *
 * Akış:
 *  1. İlk ödeme `createPaymentToken({ recurringPayment: true })` ile alınır → PayTR kartı saklar.
 *  2. Saklanan kart token'ı bildirimde döner ve `Subscription.providerSubscriptionId`'ye yazılır
 *     ([[lib/billing/paytr-payment.ts]]).
 *  3. Her dönem buradan YENİ bir `merchant_oid` ile HMAC imzalı istek atılır.
 *
 * **Üç ayrı sonuç, üçü de farklı davranır** — bu ayrım şart, çünkü "çekim başarısız" ile
 * "çekim yapılıp yapılmadığını bilmiyoruz" aynı şey değildir:
 *
 *   - `success: true`      → dönem uzatılır.
 *   - `success: false`     → PayTR açıkça REDDETTİ (kart limiti, son kullanma…). Abonelik
 *                            `PAST_DUE`'ya alınır; hoşgörü boyunca her gün yeniden denenir.
 *   - **fırlatır**         → ağ hatası ya da tanınmayan gövde. Abonelik DEĞİŞTİRİLMEZ;
 *                            çağıran bunu `pending` sayar ve ertesi gün tekrar dener.
 *                            Sonucu bilmediğimiz bir çekimi "başarısız" saymak, parası
 *                            çekilmiş müşteriyi hoşgörüye düşürürdü.
 *
 * `PAYTR_RECURRING_ENABLED` kapalıyken CANLI ÇAĞRI YAPILMAZ: eski davranış korunur
 * (fırlatır → abonelik olduğu gibi kalır). Böylece ürün açılana kadar sistem yanlış bir
 * şey yapmaz, açıldığında tek env ile devreye girer.
 *
 * ⚠️ Uç adresi ve alan adları PayTR ile TEYİT EDİLMELİ —
 * docs/paket-abonelik/PAYTR-RECURRING-KONTROL.md.
 */
export async function chargeRecurringPayment(
  input: RecurringChargeInput,
): Promise<RecurringChargeResult> {
  const creds = getPaytrCredentials()
  if (!creds || !isRecurringEnabled()) {
    throw new Error(PAYTR_RECURRING_NOT_IMPLEMENTED)
  }

  const { merchantId, merchantKey, merchantSalt, testMode } = creds
  const currency = input.currency ?? "TL"

  // PayTR'ın değişmeyen imza deseni: base64( HMAC_SHA256( hashStr + salt, key ) ).
  // hashStr'in İÇERİĞİ uca göre değişir; buradaki sıra teyit edilecek alanlardan biridir.
  const hashStr =
    `${merchantId}${input.merchantOid}${input.paymentAmount}` +
    `${input.cardToken}${currency}${testMode}`
  const paytrToken = crypto
    .createHmac("sha256", merchantKey)
    .update(hashStr + merchantSalt)
    .digest("base64")

  const form = new URLSearchParams({
    merchant_id: merchantId,
    merchant_oid: input.merchantOid,
    payment_amount: String(input.paymentAmount),
    utoken: input.cardToken,
    user_ip: input.userIp,
    email: input.email,
    currency,
    test_mode: testMode,
    paytr_token: paytrToken,
  })

  const res = await fetch(PAYTR_RECURRING_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })

  const raw = await res.text()
  let data: { status?: string; reason?: string; err_msg?: string; payment_id?: string } | null = null
  try {
    data = JSON.parse(raw)
  } catch {
    data = null
  }

  if (!data || typeof data.status !== "string") {
    // Gövdeyi tanımıyoruz → çekim OLMUŞ OLABİLİR. Durumu değiştirmeden fırlat.
    console.error(
      `[paytr-recurring] tanınmayan yanıt (HTTP ${res.status}) oid=${input.merchantOid}: ` +
        raw.slice(0, 500),
    )
    throw new Error(PAYTR_RECURRING_UNKNOWN_RESPONSE)
  }

  if (data.status === "success") {
    return { success: true, paymentRef: data.payment_id ? String(data.payment_id) : "PAYTR" }
  }

  return { success: false, failReason: data.reason || data.err_msg || "PayTR çekimi reddetti" }
}

/**
 * Callback (bildirim) hash doğrulaması:
 * hash = base64( HMAC_SHA256( merchant_oid + merchant_salt + status + total_amount, merchant_key ) )
 * Timing-safe karşılaştırılır.
 */
export function verifyCallbackHash(p: {
  merchantOid: string
  status: string
  totalAmount: string
  hash: string
}): boolean {
  const creds = getPaytrCredentials()
  if (!creds) return false
  const computed = crypto
    .createHmac("sha256", creds.merchantKey)
    .update(`${p.merchantOid}${creds.merchantSalt}${p.status}${p.totalAmount}`)
    .digest("base64")
  const a = Buffer.from(computed)
  const b = Buffer.from(p.hash || "")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
