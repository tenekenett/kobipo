// İNTERNET SATIŞ BİLGİLERİ — Invoice.internetSalesInfo ile Mysoft
// InvoiceDraftModel.internetShipmentInfo arasındaki ortak şekil.
//
// NEDEN: Uzaktan yapılan MAL satışında e-Arşiv faturada ödeme şekli/tarihi ve gönderi
// bilgisi gösterilir; belgedeki "Bu satış internet üzerinden yapılmıştır" ibaresi de
// buna bağlı basılır.
//
// KOBIPO KENDİ SATIŞLARINDA BU BİLGİYİ YAZMAZ (2026-08-26): kontör/abonelik dijital
// HİZMETTİR. Alan dolu gönderildiğinde GİB şablonu belgenin altına mesafeli satış
// İADE BÖLÜMÜ tablosunu ("kusurlu ürün", "beden uymaması", "kargo hasarı"…) basıyor
// ve alıcıya var olmayan bir ürün iadesi yolu gösteriyordu. Bu yüzden
// lib/invoicing/issue-sales-invoice.ts artık buildInternetSalesInfo() ÇAĞIRMAZ;
// modül, ileride gerçek bir uzaktan mal satışı eklenirse diye durur.
//
// Kargo/taşıyıcı alanları (shippingDate, shippingAccountName, shippingAccountVknTckn)
// MAL SEVKİNE bağlıdır; kontör ve abonelik dijital hizmettir, sevk yoktur → bu alanlar
// hiç gönderilmez. Tip de onları taşımaz ki ileride yanlışlıkla doldurulmasın.

/** Mysoft'un kabul ettiği ödeme şekli kümesi — GİB listesiyle birebir, serbest metin değil. */
export const INTERNET_PAYMENT_TYPES = [
  "KREDIKARTI/BANKAKARTI",
  "EFT/HAVALE",
  "KAPIDAODEME",
  "ODEMEARACISI",
  "DIGER",
] as const

export type InternetPaymentType = (typeof INTERNET_PAYMENT_TYPES)[number]

export type InternetSalesInfo = {
  /** Satışın yapıldığı web adresi. */
  webSiteUrl?: string
  paymentType: InternetPaymentType
  /** Ödeme aracısı (ödeme kuruluşu) ünvanı — yalnız kartlı ödemede anlamlı. */
  internetAccountName?: string
  /** YYYY-MM-DD. Kartlı ödemede ZORUNLU. */
  paymentDate?: string
  paymentNote?: string
}

/** Kobipo'nun sanal POS'unu sağlayan ödeme kuruluşunun ünvanı (belgede görünür). */
export const PAYTR_LEGAL_NAME = "PayTR Ödeme ve Elektronik Para Kuruluşu A.Ş."

const FALLBACK_SITE_URL = "https://kobipo.com"

/**
 * Belgeye yazılacak web adresi. NEXT_PUBLIC_APP_URL geliştirme ortamında localhost'u
 * gösterir; GİB'e giden belgeye "http://localhost:3000" yazmak yerine kurumsal adrese
 * düşülür (ve uyarı loglanır) — belge, ortam yapılandırmasının kurbanı olmamalı.
 */
export function resolveWebSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "")
  if (!raw) return FALLBACK_SITE_URL
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(raw)) {
    console.warn(
      `[internet-sales] NEXT_PUBLIC_APP_URL yerel adres ("${raw}") — belgeye ${FALLBACK_SITE_URL} yazılıyor.`,
    )
    return FALLBACK_SITE_URL
  }
  return raw
}

/** YYYY-MM-DD (mükellefin takvim günü; sunucu UTC'de koşsa da). */
function dayInTurkey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date)
}

/**
 * Kobipo'nun kendi satışı için internet satış bilgisini kurar.
 *
 * @param paymentMethod Sipariş kaydındaki yöntem: "CARD" (PayTR sanal POS) | "HAVALE".
 * @param paidAt Tahsilat anı. Kartta belgede ZORUNLU alandır; verilmezse bugüne düşülür.
 */
export function buildInternetSalesInfo(params: {
  paymentMethod: string
  paidAt?: Date | null
  paymentNote?: string | null
}): InternetSalesInfo {
  const isCard = String(params.paymentMethod || "").toUpperCase() === "CARD"
  const info: InternetSalesInfo = {
    webSiteUrl: resolveWebSiteUrl(),
    paymentType: isCard ? "KREDIKARTI/BANKAKARTI" : "EFT/HAVALE",
    paymentDate: dayInTurkey(params.paidAt ?? new Date()),
  }
  // Ödeme aracısı yalnız kartlı ödemede vardır; havalede para doğrudan banka
  // hesabına geçtiği için aracı yazmak yanıltıcı olur.
  if (isCard) info.internetAccountName = PAYTR_LEGAL_NAME
  if (params.paymentNote && params.paymentNote.trim()) {
    info.paymentNote = params.paymentNote.trim().slice(0, 200)
  }
  return info
}

/**
 * DB'den (Json) okunan değeri güvenli tipe çevirir. Tanınmayan/eksik ödeme şekli →
 * null: belgeye yarım internet satış bilgisi yazmaktansa hiç yazmamak doğrudur,
 * yarımı GİB şematronuna takılır.
 */
export function parseInternetSalesInfo(raw: unknown): InternetSalesInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const paymentType = typeof o.paymentType === "string" ? o.paymentType : ""
  if (!INTERNET_PAYMENT_TYPES.includes(paymentType as InternetPaymentType)) return null

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined

  return {
    paymentType: paymentType as InternetPaymentType,
    webSiteUrl: str(o.webSiteUrl),
    internetAccountName: str(o.internetAccountName),
    paymentDate: str(o.paymentDate),
    paymentNote: str(o.paymentNote),
  }
}
