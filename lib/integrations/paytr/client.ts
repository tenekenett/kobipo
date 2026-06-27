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
