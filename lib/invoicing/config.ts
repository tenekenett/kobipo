// Otomatik faturalandırmanın yapılandırması ve KAPILARI.
// Plan: docs/faturalandirma/PLAN.md (Faz 4.5)
//
// Buradaki üç kapı, "ödemesi alınmamış bir satış için GİB'e gerçek belge gitmesini"
// engeller. Belge, DB satırının aksine geri alınması pahalı bir nesnedir: hasılat ve
// hesaplanan KDV doğurur, e-Arşiv raporuna girer, alıcı e-Fatura mükellefiyse doğrudan
// onun gelen kutusuna düşer. Bu yüzden kapılar servisin İÇİNDE, belge oluşturulmadan
// önce çalışır — çağıran tarafın hatırlamasına bırakılmaz.

import { prisma } from "@/lib/db/prisma"

/**
 * Satıcı firma env'de tanımlı değilse bu VKN ile çözülür: REYPO BİLİŞİM SAN. VE TİC.
 * LTD. ŞTİ. — Kobipo'nun tüzel kişisi ve Mysoft'taki İş Ortağı (bayi) hesabının sahibi.
 * Bayi kimliği (MYSOFT_PARTNER_USERNAME) de bu firmaya aittir.
 */
export const KOBIPO_SELLER_FALLBACK_VKN = "7352344835"

const env = (key: string): string => (process.env[key] || "").trim()

/** Satıcı firma id'si: env → VKN ile arama. Bulunamazsa null (servis hata döner). */
export async function resolveSellerCompanyId(): Promise<string | null> {
  const explicit = env("KOBIPO_SELLER_COMPANY_ID")
  if (explicit) return explicit

  const vkn = env("KOBIPO_SELLER_TAX_NUMBER") || KOBIPO_SELLER_FALLBACK_VKN
  const company = await prisma.company.findFirst({
    where: { taxNumber: vkn, parentCompanyId: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })
  if (!company) {
    console.error(
      `[faturalandirma] Satıcı firma bulunamadı (VKN ${vkn}). KOBIPO_SELLER_COMPANY_ID ayarlayın.`,
    )
    return null
  }
  return company.id
}

/** Ana şalter. Kapalıyken hiç fatura kesilmez — bu bir HATA değil, kapalı olma halidir. */
export function isAutoInvoiceEnabled(): boolean {
  return env("KOBIPO_AUTO_INVOICE_ENABLED").toLowerCase() === "true"
}

/**
 * Bu tarihten ÖNCE ödenen siparişler faturalanmaz. Geriye dönük süpürmeyi engelleyen
 * kapı budur: sistem açıldığı gece, "faturasız ödenmiş siparişleri tekrar dene" işi
 * geçmişteki (çoğu test) siparişlere toplu belge kesmesin.
 *
 * Tanımsızsa GÜVENLİ tarafa düşülür: hiçbir sipariş faturalanmaz. Böylece bayrağı
 * açıp tarihi vermeyi unutmak, tarihi geçmişe ayarlamaktan daha zararsız olur.
 */
export function autoInvoiceStartAt(): Date | null {
  const raw = env("KOBIPO_AUTO_INVOICE_START_AT")
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    console.error(`[faturalandirma] KOBIPO_AUTO_INVOICE_START_AT okunamadı: "${raw}"`)
    return null
  }
  return d
}

export type InvoiceGateResult = { ok: true } | { ok: false; reason: string }

/**
 * Siparişin faturalanıp faturalanmayacağına karar verir. `ok:false` bir HATA DEĞİLDİR:
 * çağıran taraf `invoiceError` yazmaz, yalnız loglar — sipariş ve kontör yüklemesi
 * normal seyrine devam eder.
 */
export function checkInvoiceGates(order: {
  isTest: boolean
  paidAt: Date | null
}): InvoiceGateResult {
  if (!isAutoInvoiceEnabled()) {
    return { ok: false, reason: "Otomatik faturalandırma kapalı (KOBIPO_AUTO_INVOICE_ENABLED)" }
  }

  if (order.isTest) {
    return { ok: false, reason: "Test siparişi — ödeme tahsil edilmedi, belge kesilmez" }
  }

  const startAt = autoInvoiceStartAt()
  if (!startAt) {
    return { ok: false, reason: "KOBIPO_AUTO_INVOICE_START_AT tanımsız" }
  }
  // paidAt yoksa (havale: admin onayı) sipariş "şimdi" ödenmiş sayılır; geçmişten
  // gelen bir kayıt olmadığı için kapıyı geçer.
  const paidAt = order.paidAt ?? new Date()
  if (paidAt < startAt) {
    return {
      ok: false,
      reason: `Ödeme tarihi (${paidAt.toISOString()}) faturalandırma başlangıcından (${startAt.toISOString()}) önce`,
    }
  }

  return { ok: true }
}

/**
 * Sipariş oluşturma anında yazılacak test damgası. PayTR test modunda para ÇEKİLMEZ
 * ama callback success döner; havale akışında test modu kavramı yoktur (admin gerçek
 * parayı görüp onaylar), o yüzden yalnız kart siparişleri damgalanır.
 */
export function isTestPurchase(paymentMethod: string): boolean {
  if (paymentMethod !== "CARD") return false
  // client.ts ile aynı okuma: açıkça "0" yazılmadıkça test kabul edilir.
  return env("PAYTR_TEST_MODE") !== "0"
}
