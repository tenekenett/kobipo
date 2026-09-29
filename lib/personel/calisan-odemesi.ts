/**
 * ÇALIŞAN CEBİNDEN ÖDEME — kural ve sabitler (SAF modül: istemci + sunucu).
 *
 * Çalışan bir alış faturasını kendi parasıyla öder:
 *
 *   InvoicePayment  paymentMethod "EMPLOYEE", accountId null, transactionId null
 *                   → fatura kapanır, tedarikçi bakiyesi düşer (kasasız ödeme,
 *                     bakiye kapamayla aynı okuma yolu — lib/cari/bakiye-kapama.ts)
 *   EmployeeLedgerEntry kind "EXPENSE" → firma çalışana borçlanır
 *
 * Firma sonra "Çalışana öde" ile borcu kapatır:
 *
 *   Transaction     EXPENSE, reference "CALISAN:<employeeId>" → kasadan para çıkar
 *   EmployeeLedgerEntry kind "REIMBURSEMENT"
 *
 * GİDER BİR KEZ SAYILIR: gider alış faturasıdır. Geri ödeme hareketi kâr/zarar,
 * gelir-gider ve harcamalar raporunda "faturasız gider" SAYILMAZ (önek süzgeci,
 * lib/finans/nakit-hareket.ts); nakit akışında ise fatura ödemesi olarak sayılır —
 * para gerçekten o gün çıkmıştır.
 *
 * Yalnız TL faturada: defter tek para birimiyle toplanır, dövizli bir ödeme TL
 * borcuna eklenirse bakiye anlamsızlaşırdı.
 */

export const CALISAN_ODEMESI_METHOD = "EMPLOYEE"

export const CALISAN_ODEMESI_LABEL = "Çalışan Cebinden"

export function isCalisanOdemesi(paymentMethod: string | null | undefined): boolean {
  return String(paymentMethod || "").toUpperCase() === CALISAN_ODEMESI_METHOD
}

/** Defter satırı türleri. */
export const LEDGER_EXPENSE = "EXPENSE"
export const LEDGER_REIMBURSEMENT = "REIMBURSEMENT"

/**
 * Bakiye: + firmanın çalışana borcu, − çalışanın firmaya borcu (fazla ödenmiş iade
 * ya da iadesi yapılmış bir ödemenin sonradan silinmesi). İşaret kırpılmaz — bilanço
 * negatif bakiyeyi "personelden alacak" diye aktife yazar.
 */
export function ledgerBalance(rows: Array<{ kind: string; amount: number }>): number {
  let total = 0
  for (const r of rows) {
    if (r.kind === LEDGER_EXPENSE) total += r.amount
    else if (r.kind === LEDGER_REIMBURSEMENT) total -= r.amount
  }
  return Math.round(total * 100) / 100
}

// ── Alış faturası "Ödeme durumu" ──────────────────────────────────────────────

/**
 * Editördeki üç seçenek. "Ödenecek" gövdeye hiç yazılmaz (bugünkü davranış: fatura
 * açık kalır, vadesi `dueDate`tir); diğer ikisi faturayla AYNI istekte tam tutarlık
 * bir ödeme yazar (lib/invoice/create-invoice.ts).
 */
export type PurchasePaymentStatus = "UNPAID" | "PAID" | "EMPLOYEE"

export type PurchasePayment =
  | { status: "PAID"; accountId: string | null; paymentDate: string | null }
  | { status: "EMPLOYEE"; employeeId: string; paymentDate: string | null }

export type ParsedPurchasePayment =
  | { ok: true; value: PurchasePayment | null }
  | { ok: false; error: string }

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** "YYYY-MM-DD" ya da ISO; geçersiz tarih reddedilir, yok yazılmaz. */
function dateOrError(v: unknown): { ok: true; value: string | null } | { ok: false } {
  const s = text(v)
  if (!s) return { ok: true, value: null }
  return Number.isNaN(new Date(s).getTime()) ? { ok: false } : { ok: true, value: s }
}

/**
 * Gövdedeki `purchasePayment` alanını doğrular. Alan yoksa ya da "Ödenecek" ise
 * `null` döner (ödeme yazılmaz). Tip/para birimi uygunluğu çağıranın işidir:
 * `purchasePaymentBlocker`.
 */
export function parsePurchasePayment(raw: unknown): ParsedPurchasePayment {
  if (raw == null) return { ok: true, value: null }
  if (typeof raw !== "object") return { ok: false, error: "Ödeme durumu okunamadı" }
  const r = raw as Record<string, unknown>
  const status = String(r.status || "").toUpperCase()
  if (status === "" || status === "UNPAID") return { ok: true, value: null }

  const date = dateOrError(r.paymentDate)
  if (!date.ok) return { ok: false, error: "Ödeme tarihi geçersiz" }

  if (status === "PAID") {
    return { ok: true, value: { status: "PAID", accountId: text(r.accountId), paymentDate: date.value } }
  }
  if (status === "EMPLOYEE") {
    const employeeId = text(r.employeeId)
    if (!employeeId) return { ok: false, error: "Ödemeyi yapan çalışanı seçin" }
    return { ok: true, value: { status: "EMPLOYEE", employeeId, paymentDate: date.value } }
  }
  return { ok: false, error: "Geçersiz ödeme durumu" }
}

/**
 * Faturayla birlikte ödeme yazılabilir mi? Yazılamıyorsa sebebi döner; fatura HİÇ
 * açılmadan reddedilir — önce fatura açılıp sonra ödemenin düşmesi, kullanıcının
 * "ödendi" dediği bir belgeyi açık bırakırdı.
 */
export function purchasePaymentBlocker(
  payment: PurchasePayment,
  invoice: { type: string; currency?: string | null; isReceipt?: boolean },
): string | null {
  if (String(invoice.type).toUpperCase() !== "PURCHASE" || invoice.isReceipt) {
    return "Ödeme durumu yalnız alış faturasında seçilir"
  }
  if (payment.status === "EMPLOYEE" && (invoice.currency || "TRY") !== "TRY") {
    return "Döviz faturası çalışan cebinden ödendi olarak işaretlenemez; çalışan borcu TL tutulur"
  }
  return null
}
