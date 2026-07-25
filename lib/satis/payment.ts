// Satış ekranlarının ödeme kutusu — SAF mantık (React'e bağlı değil).
//
// Hızlı Satış (components/satis/quick-sale-screen.tsx) bu davranışı satır içi
// çözmüştü; kahveci satış ekranı (Adım 7) aynısına ihtiyaç duyduğu için mantık
// buraya alındı. UI parçası: components/satis/payment-panel.tsx
//
// Kritik nokta — tahsilat tutarı FATURANIN SUNUCUDA KAYITLI toplamından
// hesaplanmalı: istemcinin yuvarlanmamış toplamı (birim fiyat geri-hesabından
// gelen küsurat) sunucunun 2 haneye yuvarladığı totalAmount'ı aşarsa ödeme
// reddedilir. Bu yüzden buildPaymentParts total'i dışarıdan alır.

export type PaymentMethod = "CASH" | "CREDIT_CARD" | "BANK_TRANSFER"

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Nakit",
  CREDIT_CARD: "Kredi Kartı",
  BANK_TRANSFER: "Havale/EFT",
}

export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CREDIT_CARD", "BANK_TRANSFER"]

export type PaymentSplit = Record<PaymentMethod, string>

export type PaymentState = {
  method: PaymentMethod
  /** Veresiye / açık hesap — hiç tahsilat yazılmaz. */
  isCredit: boolean
  splitMode: boolean
  split: PaymentSplit
  /** Nakitte müşterinin verdiği tutar; yalnız para üstü için — tahsilat değil. */
  tendered: string
  accountId: string
}

export type PaymentPart = { method: PaymentMethod; amount: number; accountId?: string }

export const emptySplit = (): PaymentSplit => ({ CASH: "", CREDIT_CARD: "", BANK_TRANSFER: "" })

export const emptyPaymentState = (accountId = ""): PaymentState => ({
  method: "CASH",
  isCredit: false,
  splitMode: false,
  split: emptySplit(),
  tendered: "",
  accountId,
})

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** "12,50" ve "12.50" ikisini de kabul eder; geçersizse 0. */
export const parseAmount = (v: string | number | null | undefined): number =>
  parseFloat(String(v ?? "").replace(",", ".")) || 0

export const splitTotal = (split: PaymentSplit): number =>
  round2(parseAmount(split.CASH) + parseAmount(split.CREDIT_CARD) + parseAmount(split.BANK_TRANSFER))

export type PaymentSummary = {
  /** Faturaya işlenecek tahsilat toplamı. */
  paid: number
  /** Müşterinin verdiği nakit (para üstü hesabı için); kart/havalede tutara eşit. */
  tendered: number
  change: number
  /** Açık kalan tutar — veresiyede tamamı, parçalı ödemede eksik kalan kısım. */
  remaining: number
}

export function paymentSummary(state: PaymentState, total: number): PaymentSummary {
  const t = round2(total)
  if (state.isCredit) return { paid: 0, tendered: 0, change: 0, remaining: t }

  if (state.splitMode) {
    const entered = splitTotal(state.split)
    return {
      paid: Math.min(entered, t),
      tendered: entered,
      change: Math.max(0, round2(entered - t)),
      remaining: Math.max(0, round2(t - entered)),
    }
  }

  // Tek yöntemde tahsilat daima tutarın tamamı; nakit fazlası para üstüdür.
  const handed = state.method === "CASH" ? parseAmount(state.tendered) : 0
  return {
    paid: t,
    tendered: handed > 0 ? handed : t,
    change: handed > 0 ? Math.max(0, round2(handed - t)) : 0,
    remaining: 0,
  }
}

/**
 * Faturaya yazılacak tahsilat parçaları.
 *
 * Parçalı modda kart/havale ÖNCE, nakit EN SONA işlenir: böylece toplam tutarı
 * aşan kısım nakitten kırpılır ve para üstü olarak yutulur (kartın fazlası
 * kırpılsaydı gerçekte çekilmiş tutar eksik kaydedilirdi).
 */
export function buildPaymentParts(
  state: PaymentState,
  args: { total: number; cashAccountId?: string; bankAccountId?: string }
): PaymentPart[] {
  const total = round2(args.total)
  if (state.isCredit || total <= 0) return []

  const accountFor = (m: PaymentMethod) =>
    ((m === "CASH" ? args.cashAccountId : args.bankAccountId) ?? state.accountId) || undefined

  if (!state.splitMode) {
    return [{ method: state.method, amount: total, accountId: state.accountId || undefined }]
  }

  const parts: PaymentPart[] = []
  let remaining = total
  for (const m of ["CREDIT_CARD", "BANK_TRANSFER", "CASH"] as PaymentMethod[]) {
    const want = round2(parseAmount(state.split[m]))
    if (want <= 0) continue
    const pay = Math.min(want, round2(remaining))
    if (pay <= 0) continue
    parts.push({ method: m, amount: pay, accountId: accountFor(m) })
    remaining = round2(remaining - pay)
  }
  return parts
}

/** Fişe basılacak ödeme dökümü (parçalı modda). */
export const receiptParts = (parts: PaymentPart[]) =>
  parts.map((p) => ({ label: PAYMENT_METHOD_LABELS[p.method], amount: p.amount }))
