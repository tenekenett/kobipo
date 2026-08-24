// Satın alma öncesi toplanan FATURA BİLGİSİ — doğrulama ve normalleştirme.
//
// NEDEN ÖDEME ÖNCESİ: belge, tahsilattan sonra kesilir ve o an eksik bilgi bir hataya
// değil, faturasız kalmış bir satışa dönüşür (parası alınmış, belgesi yok). Bilgiyi
// ödeme öncesi zorunlu tutmak, bu durumu baştan imkânsız kılar.
//
// Sunucu tarafı tek yetkilidir: aynı kurallar istemcide de gösterilir ama karar burada
// verilir — sipariş uçları eksik bilgiyle sipariş AÇMAZ (412).

export type BillingInput = {
  name: string
  taxNumber: string
  taxOffice: string | null
  address: string
  city: string
  district: string | null
  email: string
}

export type BillingValidation =
  | { ok: true; value: BillingInput }
  | { ok: false; error: string; fields: string[] }

export const ERR_BILLING_INCOMPLETE =
  "Fatura bilgileriniz eksik. Satın almadan önce ünvan, VKN/TCKN, vergi dairesi, adres, il ve e-posta bilgilerini doldurun."

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/** Türkiye'de VKN 10, TCKN 11 hanedir; hepsi aynı rakam olan değerler placeholder'dır. */
export function isValidTaxNumber(raw: unknown): boolean {
  const digits = str(raw).replace(/\D/g, "")
  return /^\d{10,11}$/.test(digits) && !/^(\d)\1+$/.test(digits)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Ham girdiyi (istek gövdesi ya da firma kartı) doğrulanmış fatura bilgisine çevirir.
 * `fields`, istemcinin hangi alanı kırmızıya boyayacağını bilmesi için döner.
 */
export function normalizeBillingInput(raw: unknown): BillingValidation {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const missing: string[] = []

  const name = str(o.name)
  if (name.length < 3) missing.push("name")

  const taxNumber = str(o.taxNumber).replace(/\D/g, "")
  if (!isValidTaxNumber(taxNumber)) missing.push("taxNumber")

  // Vergi dairesi yalnız MÜKELLEF (10 haneli VKN) için zorunludur; TCKN ile alışveriş
  // eden gerçek kişinin vergi dairesi yoktur.
  const taxOffice = str(o.taxOffice)
  if (taxNumber.length === 10 && taxOffice.length < 2) missing.push("taxOffice")

  const address = str(o.address)
  if (address.length < 5) missing.push("address")

  const city = str(o.city)
  if (city.length < 2) missing.push("city")

  const email = str(o.email)
  if (!EMAIL_RE.test(email)) missing.push("email")

  if (missing.length > 0) {
    return { ok: false, error: ERR_BILLING_INCOMPLETE, fields: missing }
  }

  return {
    ok: true,
    value: {
      name,
      taxNumber,
      taxOffice: taxOffice || null,
      address,
      city,
      district: str(o.district) || null,
      email,
    },
  }
}

/** Sipariş kaydına yazılacak snapshot alanları. */
export function billingSnapshot(b: BillingInput) {
  return {
    billingName: b.name,
    billingTaxNumber: b.taxNumber,
    billingTaxOffice: b.taxOffice,
    billingAddress: b.address,
    billingCity: b.city,
    billingDistrict: b.district,
    billingEmail: b.email,
  }
}

/**
 * Firma kartında YALNIZ BOŞ olan alanları doldurur.
 *
 * Kartı ezmiyoruz: `name` firmanın resmî ünvanıdır ve panelin her yerinde (şube
 * seçici, e-belge gönderen bilgisi, raporlar) kullanılır; bir satın alma formundan
 * gelen metinle üzerine yazmak, satın almayla ilgisi olmayan yerleri sessizce
 * değiştirir. Satışın beyanı her hâlükârda siparişin snapshot'ında saklıdır.
 */
export function companyFillFromBilling(
  company: {
    taxNumber: string | null
    taxOffice: string | null
    address: string | null
    city: string | null
    email: string | null
  },
  b: BillingInput,
): Record<string, string> {
  const patch: Record<string, string> = {}
  if (!str(company.taxNumber)) patch.taxNumber = b.taxNumber
  if (!str(company.taxOffice) && b.taxOffice) patch.taxOffice = b.taxOffice
  if (!str(company.address)) patch.address = b.address
  if (!str(company.city)) patch.city = b.city
  if (!str(company.email)) patch.email = b.email
  return patch
}
