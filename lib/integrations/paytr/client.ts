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
  "PayTR yinelenen (recurring) çekim henüz canlıya alınmadı. İlk dönem ödemesi ve tüm enforcement çalışır; otomatik yenileme için PayTR hesabında recurring ürünü açılıp bu istemci canlı API'ye bağlanmalıdır."

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
 * İSKELE (Aşama 6) — saklı kartla yinelenen (recurring) çekim.
 *
 * Amaçlanan akış (canlıya alınırken doldurulacak):
 *  1. İlk ödeme `createPaymentToken({ recurringPayment: true })` ile alınır → PayTR kartı saklar.
 *  2. Saklanan kart token'ı `Subscription.providerSubscriptionId`'ye yazılır (callback/karttan).
 *  3. Her dönem, PayTR "Tekrarlayan Ödeme" API'sine YENİ bir `merchant_oid` ile HMAC imzalı istek
 *     atılır; sonuç senkron döner ve/veya callback gelir. `input.cardToken` bu çekimde kullanılır.
 *
 * Bilinçli olarak CANLI çağrı YAPMAZ ve state DEĞİŞTİRMEZ — yanlış/çift çekimi önlemek için
 * `PAYTR_RECURRING_NOT_IMPLEMENTED` fırlatır. `recurring/run` bunu yakalar ve aboneliği
 * OLDUĞU GİBİ bırakır. Canlıya alırken burada gerçek PayTR isteği kurulmalı ve
 * `RecurringChargeResult` döndürülmelidir.
 */
export async function chargeRecurringPayment(
  _input: RecurringChargeInput,
): Promise<RecurringChargeResult> {
  throw new Error(PAYTR_RECURRING_NOT_IMPLEMENTED)
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
