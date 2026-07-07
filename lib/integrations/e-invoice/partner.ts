import { MysoftEInvoiceProvider } from "./mysoft-provider"
import { MYSOFT_PROD_URL } from "./constants"

/**
 * Kobipo'nun Mysoft İş Ortağı (bayi) kimlik bilgileri.
 *
 * ÖNEMLİ: Bu kimlik müşteri başına DEĞİL — uygulama geneli TEK master bayi hesabıdır
 * (env'de saklanır). Kontör yükleme (insertDocumentCredit), tarife listesi ve havuz
 * sorguları bu kimlikle yapılır. Müşterilerin kendi mükellef kimliğiyle karıştırılmamalı.
 */

export const PARTNER_NOT_CONFIGURED_ERROR =
  "Mysoft İş Ortağı (bayi) kimlik bilgileri yapılandırılmamış. Sunucuda MYSOFT_PARTNER_USERNAME ve MYSOFT_PARTNER_PASSWORD ortam değişkenlerini ayarlayın."

export function getPartnerCredentials(): {
  username: string
  password: string
  baseUrl: string
} | null {
  const username = process.env.MYSOFT_PARTNER_USERNAME?.trim()
  const password = process.env.MYSOFT_PARTNER_PASSWORD?.trim()
  if (!username || !password) return null
  // Bayi API genelde canlı (prod) ortamdadır; gerekirse env ile override edilir.
  const baseUrl = process.env.MYSOFT_PARTNER_API_URL?.trim() || MYSOFT_PROD_URL
  return { username, password, baseUrl }
}

/**
 * Bayi (İş Ortağı) kimliğiyle bir Mysoft provider örneği üretir.
 * Kimlik yapılandırılmamışsa null döner.
 *
 * @param vknTckn Belge işlemleri (fatura/inbox) bir müşteri adına yapılırken, o müşterinin
 *   VKN'si `tenantIdentifierNumber` olarak geçer — provider bunu vknTckn olarak kullanır.
 *   Bayi geneli sorgular (tarife/kontör) için boş bırakılır.
 */
export function createPartnerProvider(vknTckn?: string): MysoftEInvoiceProvider | null {
  const creds = getPartnerCredentials()
  if (!creds) return null
  return new MysoftEInvoiceProvider({
    username: creds.username,
    passwordText: creds.password,
    baseUrl: creds.baseUrl,
    vknTckn: vknTckn?.trim() || undefined,
  })
}
