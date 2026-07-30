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
//
// PARÇALI ÖDEME ARTIK LİSTE (2026-07-30): eskiden `Record<PaymentMethod, string>`
// idi, yani "yönteme anahtarlı" — iki kredi kartıyla ödenen bir hesap TEK satıra
// çöküyordu. Kafede en sık bölme biçimi tam olarak budur ("ben kartla, o da
// kartla"). Artık her parça kendi satırıdır: aynı yöntem birden çok kez, farklı
// yemek kartı sağlayıcıları ayrı ayrı yazılabilir.

export type PaymentMethod = "CASH" | "CREDIT_CARD" | "MEAL_CARD" | "BANK_TRANSFER"

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Nakit",
  CREDIT_CARD: "Kredi Kartı",
  MEAL_CARD: "Yemek Kartı",
  BANK_TRANSFER: "Havale/EFT",
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "CREDIT_CARD",
  "MEAL_CARD",
  "BANK_TRANSFER",
]

/**
 * Yemek kartı sağlayıcıları. Ödeme TİPİ olarak tutuluyorlar (entegrasyon değil):
 * gün sonu mutabakatında "kartla 4.200 TL" yetmez — Multinet ekstresi ayrı,
 * Sodexo ekstresi ayrı gelir, hangi sağlayıcıdan ne tahsil edildiği bilinmeli.
 */
export const MEAL_CARD_PROVIDERS = [
  "Multinet",
  "Sodexo (Pluxee)",
  "Edenred (Ticket)",
  "Setcard",
  "Metropol",
  "Paye",
  "Diğer",
] as const

export type PaymentPortion = {
  /** Yalnız listede kimlik için — sunucuya gitmez. */
  id: string
  method: PaymentMethod
  /** Yemek kartında sağlayıcı adı. */
  provider?: string
  amount: string
}

export type PaymentState = {
  method: PaymentMethod
  /** Tek yöntemli ödemede yemek kartı sağlayıcısı. */
  provider?: string
  /** Veresiye / açık hesap — hiç tahsilat yazılmaz. */
  isCredit: boolean
  splitMode: boolean
  /** Parçalı ödemede satırlar; aynı yöntem birden çok kez olabilir. */
  portions: PaymentPortion[]
  /** Nakitte müşterinin verdiği tutar; yalnız para üstü için — tahsilat değil. */
  tendered: string
  accountId: string
}

export type PaymentPart = {
  method: PaymentMethod
  amount: number
  provider?: string
  accountId?: string
}

let portionSeq = 0
export const newPortion = (method: PaymentMethod = "CASH", amount = ""): PaymentPortion => ({
  id: `p${++portionSeq}`,
  method,
  amount,
})

export const emptyPaymentState = (accountId = ""): PaymentState => ({
  method: "CASH",
  isCredit: false,
  splitMode: false,
  portions: [newPortion("CASH"), newPortion("CREDIT_CARD")],
  tendered: "",
  accountId,
})

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** "12,50" ve "12.50" ikisini de kabul eder; geçersizse 0. */
export const parseAmount = (v: string | number | null | undefined): number =>
  parseFloat(String(v ?? "").replace(",", ".")) || 0

export const portionsTotal = (portions: PaymentPortion[]): number =>
  round2(portions.reduce((sum, p) => sum + parseAmount(p.amount), 0))

/** Ödeme yönteminin ekranda ve fişte görünen adı (sağlayıcı varsa onunla). */
export const paymentLabelOf = (method: PaymentMethod, provider?: string | null) =>
  provider && method === "MEAL_CARD"
    ? `${PAYMENT_METHOD_LABELS[method]} (${provider})`
    : PAYMENT_METHOD_LABELS[method]

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
    const entered = portionsTotal(state.portions)
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
 * Parçalı modda nakit EN SONA işlenir: böylece toplam tutarı aşan kısım
 * nakitten kırpılır ve para üstü olarak yutulur (kartın fazlası kırpılsaydı
 * gerçekte çekilmiş tutar eksik kaydedilirdi). Nakit dışı parçalar kullanıcının
 * girdiği SIRAYLA kalır — iki kredi kartı iki ayrı tahsilat satırı olur.
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
    return [
      {
        method: state.method,
        amount: total,
        provider: state.method === "MEAL_CARD" ? state.provider || undefined : undefined,
        accountId: state.accountId || undefined,
      },
    ]
  }

  const ordered = [
    ...state.portions.filter((p) => p.method !== "CASH"),
    ...state.portions.filter((p) => p.method === "CASH"),
  ]

  const parts: PaymentPart[] = []
  let remaining = total
  for (const portion of ordered) {
    const want = round2(parseAmount(portion.amount))
    if (want <= 0) continue
    const pay = Math.min(want, round2(remaining))
    if (pay <= 0) continue
    parts.push({
      method: portion.method,
      amount: pay,
      provider: portion.method === "MEAL_CARD" ? portion.provider || undefined : undefined,
      accountId: accountFor(portion.method),
    })
    remaining = round2(remaining - pay)
  }
  return parts
}

/** Fişe basılacak ödeme dökümü (parçalı modda). */
export const receiptParts = (parts: PaymentPart[]) =>
  parts.map((p) => ({ label: paymentLabelOf(p.method, p.provider), amount: p.amount }))

/**
 * Tutarı N eşit parçaya böler ve KURUŞ FARKINI İLK PARÇAYA yükler.
 * 100/3 = 33,33 + 33,33 + 33,34 — üçünü de 33,33 yapmak hesabı 1 kuruş açık
 * bırakırdı ve kasiyer farkı elle kapatmak zorunda kalırdı.
 */
export function splitEqually(total: number, count: number): string[] {
  const t = round2(total)
  const n = Math.max(1, Math.trunc(count))
  const base = Math.floor((t * 100) / n) / 100
  const parts = Array.from({ length: n }, () => base)
  parts[0] = round2(base + (t - base * n))
  return parts.map((p) => p.toFixed(2))
}
