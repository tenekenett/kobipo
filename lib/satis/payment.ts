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

/**
 * Kasiyerin yazdığı tutarı sayıya çevirir — BİNLİK AYRACI dahil.
 *
 * Eskiden yalnız ilk virgülü noktaya çeviriyordu (`replace(",", ".")`) ve
 * binlik ayracı yazan herkes sessizce yanlış tutar giriyordu:
 *
 *   "1.500"    → 1,5        "1.500,50" → 1,5
 *   "1 500"    → 1          "1,500,000" → 1
 *
 * Sonuç iki yerde birden görünüyordu: para üstü hep ₺0,00 çıkıyordu ("ne
 * girersem gireyim" şikâyeti) ve — daha kötüsü — PARÇALI ödemede 1.500 TL'lik
 * satır faturaya 1,50 TL olarak yazılıyordu.
 *
 * Kural (tr öncelikli):
 *  - İki ayraç da varsa SONUNCUSU ondalıktır: "1.500,50" da "1,500.50" da 1500,5.
 *  - Yalnız virgül varsa ondalıktır ("12,50"); birden çok virgül gruplamadır
 *    ("1,000,000" → 1000000).
 *  - Yalnız nokta varsa üçlü gruplanmışsa binliktir ("1.500" → 1500), değilse
 *    ondalık ("12.50" → 12,5). Baştaki grup 0 ise ondalık sayılır ("0.500" →
 *    0,5): "yarım lira" yazan kasiyer 500 TL girmiş olmamalı.
 *  - Boşluk/₺ gibi karakterler atılır. Negatif ve geçersiz değer 0'dır — ödeme
 *    kutusunda eksi tutarın anlamı yok.
 */
const THOUSANDS_DOT = /^[1-9]\d{0,2}(\.\d{3})+$/

export const parseAmount = (v: string | number | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : 0

  const text = String(v ?? "").trim()
  // Eksi işareti: ödeme kutusunda anlamı yok. Atıp pozitife çevirmek "-5"i 5 TL
  // tahsilat yapardı; okunamayan giriş 0 sayılır.
  if (text.startsWith("-")) return 0

  const raw = text.replace(/[^\d.,]/g, "")
  if (!raw) return 0

  const dots = raw.split(".").length - 1
  const commas = raw.split(",").length - 1

  let normalized: string
  if (dots > 0 && commas > 0) {
    const decimal = raw.lastIndexOf(".") > raw.lastIndexOf(",") ? "." : ","
    const thousands = decimal === "." ? "," : "."
    normalized = raw.split(thousands).join("")
    normalized =
      decimal === ","
        ? normalized.replace(/,([^,]*)$/, ".$1")
        : normalized
  } else if (commas > 0) {
    normalized = commas > 1 ? raw.split(",").join("") : raw.replace(",", ".")
  } else {
    normalized = THOUSANDS_DOT.test(raw) ? raw.split(".").join("") : raw
  }

  const n = parseFloat(normalized)
  return Number.isFinite(n) && n > 0 ? n : 0
}

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
  args: { total: number; cashAccountId?: string; bankAccountId?: string; cardAccountId?: string }
): PaymentPart[] {
  const total = round2(args.total)
  if (state.isCredit || total <= 0) return []

  // Kart tahsilatı ayrı bir "Kredi Kartı / POS" kanalı varsa oraya düşer; yoksa
  // eskisi gibi bankaya. Yemek kartı/havale banka kanalını kullanır.
  const accountFor = (m: PaymentMethod) => {
    const preferred =
      m === "CASH"
        ? args.cashAccountId
        : m === "CREDIT_CARD"
          ? (args.cardAccountId ?? args.bankAccountId)
          : args.bankAccountId
    return (preferred ?? state.accountId) || undefined
  }

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
