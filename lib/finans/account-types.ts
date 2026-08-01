// Finans kanalı (FinancialAccount.type) türleri ve türden çıkan ödeme yöntemi.
//
// Kasa/banka işlemlerinde (Transaction) ödeme yöntemi AYRI BİR ALAN DEĞİL: paranın
// girdiği kanalın türünden okunur. Tür seçenekleri yalnız Kasa/Banka iken "KREDİ
// KARTI" adlı bir POS hesabı zorunlu olarak BANK açılıyor, makbuzda da "Havale /
// EFT" yazıyordu. Kredi kartı / POS bu yüzden ayrı bir kanal türü.

export type FinancialAccountType = "CASH" | "BANK" | "CREDIT_CARD"

export const FINANCIAL_ACCOUNT_TYPES: Array<{ value: FinancialAccountType; label: string }> = [
  { value: "BANK", label: "Banka" },
  { value: "CASH", label: "Kasa" },
  { value: "CREDIT_CARD", label: "Kredi Kartı / POS" },
]

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CASH: "Kasa",
  BANK: "Banka",
  CREDIT_CARD: "Kredi Kartı / POS",
  // Eski/dış kaynaklı kayıtlarda görülebilir.
  POS: "Kredi Kartı / POS",
  CHECK: "Çek",
}

export const accountTypeLabel = (type: string) => ACCOUNT_TYPE_LABELS[type] ?? type

/**
 * Banka alanlarının (banka adı, hesap no, IBAN) anlamlı olduğu türler. POS
 * hesabı da bir bankaya bağlıdır — ekstre/mutabakat oradan gelir.
 */
export const accountHasBankFields = (type: string) =>
  type === "BANK" || type === "CREDIT_CARD" || type === "POS"

/** Kanal türünden InvoicePayment.paymentMethod değeri. */
export function accountPaymentMethod(type: string): string {
  switch (type) {
    case "CASH":
      return "CASH"
    case "BANK":
      return "BANK_TRANSFER"
    case "CREDIT_CARD":
    case "POS":
      return "CREDIT_CARD"
    case "CHECK":
      return "CHECK"
    default:
      return "OTHER"
  }
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit",
  BANK_TRANSFER: "Havale / EFT",
  CREDIT_CARD: "Kredi Kartı / POS",
  MEAL_CARD: "Yemek Kartı",
  CHECK: "Çek",
  OTHER: "Diğer",
}

export const paymentMethodLabel = (method: string) => PAYMENT_METHOD_LABELS[method] ?? method

/** Makbuz ve işlem detayındaki "Ödeme Yöntemi" etiketi. */
export const accountPaymentMethodLabel = (type: string) =>
  paymentMethodLabel(accountPaymentMethod(type))
