// Z raporu girdisi — SAF doğrulama ve iç tutarlılık. Plan: docs/okc/ASAMA1-KOBIPO.md A3.
//
// Aşama 1'de Z raporu gün sonunda Z FİŞİNDEN ELLE girilir. Elle girişin en sık
// hatası yazım hatasıdır (1.250 yerine 1.520); bu yüzden Z'nin KENDİ içindeki
// tutarlılık (KDV satırları toplamı = genel toplam, ödemeler toplamı = genel
// toplam) Kobipo ile karşılaştırmadan ÖNCE ayrıca gösterilir — yoksa kullanıcı
// yazım hatasını "Kobipo yanlış hesaplıyor" diye okur.

import { parseTrNumber } from "@/lib/format"

/**
 * Z fişindeki ödeme tipleri. Kobipo tahsilat yöntemleri buraya eşlenir
 * (`kobipoMethodToZ`). Veresiye cihazda "açık hesap" olarak görünür.
 */
export const Z_PAYMENT_METHODS = ["CASH", "CREDIT_CARD", "MEAL_CARD", "OPEN_ACCOUNT", "OTHER"] as const
export type ZPaymentMethod = (typeof Z_PAYMENT_METHODS)[number]

export const Z_PAYMENT_LABELS: Record<ZPaymentMethod, string> = {
  CASH: "Nakit",
  CREDIT_CARD: "Kredi kartı",
  MEAL_CARD: "Yemek kartı",
  OPEN_ACCOUNT: "Açık hesap",
  OTHER: "Diğer",
}

/** Türkiye'de geçerli KDV oranları; formda satırlar bunlarla önceden dolar. */
export const Z_DEFAULT_VAT_RATES = [1, 10, 20] as const

export type ZVatLine = { rate: number; base: number; vat: number }
export type ZPaymentLine = { method: ZPaymentMethod; amount: number }

export type ZReportFields = {
  deviceId: string
  zNo: number
  takenAt: Date
  ekuNo: string | null
  receiptCount: number | null
  grossTotal: number
  vatLines: ZVatLine[]
  paymentLines: ZPaymentLine[]
  cancelCount: number | null
  cancelTotal: number | null
  note: string | null
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = parseTrNumber(value as string | number)
  return n === null ? null : round2(n)
}

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : NaN
}

export type ZInputResult = { ok: true; data: ZReportFields } | { ok: false; error: string }

/**
 * Gövdeyi doğrular. Boş KDV / ödeme satırı (tutar 0 ya da boş) atılır: form üç
 * oranı ve beş ödeme tipini hazır gösterir, kullanıcı yalnız dolu olanları yazar.
 */
export function normalizeZInput(body: Record<string, unknown>): ZInputResult {
  const deviceId = String(body.deviceId ?? "").trim()
  if (!deviceId) return { ok: false, error: "Yazarkasa seçin" }

  const zNo = Number(body.zNo)
  if (!Number.isInteger(zNo) || zNo <= 0) return { ok: false, error: "Z numarası pozitif bir tam sayı olmalı" }

  const takenAt = new Date(String(body.takenAt ?? ""))
  if (Number.isNaN(takenAt.getTime())) return { ok: false, error: "Z'nin alındığı tarih ve saat geçersiz" }
  // Gelecek tarihli Z, saat dilimi ya da yazım hatasıdır; pencere hesabını
  // (önceki Z → bu Z) sessizce bozardı. Beş dakikalık pay saat farkı için.
  if (takenAt.getTime() > Date.now() + 5 * 60_000) {
    return { ok: false, error: "Z'nin alındığı an gelecekte olamaz" }
  }

  const grossTotal = money(body.grossTotal)
  if (grossTotal === null) return { ok: false, error: "Z toplamı zorunlu" }
  if (grossTotal < 0) return { ok: false, error: "Z toplamı negatif olamaz" }

  const receiptCount = count(body.receiptCount)
  if (Number.isNaN(receiptCount)) return { ok: false, error: "Fiş adedi tam sayı olmalı" }
  const cancelCount = count(body.cancelCount)
  if (Number.isNaN(cancelCount)) return { ok: false, error: "İptal adedi tam sayı olmalı" }
  const cancelTotal = money(body.cancelTotal)
  if (cancelTotal !== null && cancelTotal < 0) return { ok: false, error: "İptal tutarı negatif olamaz" }

  const vatLines: ZVatLine[] = []
  const seenRates = new Set<number>()
  for (const raw of Array.isArray(body.vatLines) ? body.vatLines : []) {
    const line = (raw ?? {}) as Record<string, unknown>
    const base = money(line.base)
    const vat = money(line.vat)
    if ((base ?? 0) === 0 && (vat ?? 0) === 0) continue
    const rate = Number(line.rate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: "KDV oranı geçersiz" }
    if (seenRates.has(rate)) return { ok: false, error: `%${rate} KDV satırı iki kez girilmiş` }
    if ((base ?? 0) < 0 || (vat ?? 0) < 0) return { ok: false, error: "KDV satırında negatif tutar olamaz" }
    seenRates.add(rate)
    vatLines.push({ rate, base: base ?? 0, vat: vat ?? 0 })
  }
  vatLines.sort((a, b) => a.rate - b.rate)

  const paymentLines: ZPaymentLine[] = []
  const seenMethods = new Set<string>()
  for (const raw of Array.isArray(body.paymentLines) ? body.paymentLines : []) {
    const line = (raw ?? {}) as Record<string, unknown>
    const amount = money(line.amount)
    if (!amount) continue
    const method = String(line.method ?? "") as ZPaymentMethod
    if (!Z_PAYMENT_METHODS.includes(method)) return { ok: false, error: "Ödeme tipi geçersiz" }
    if (seenMethods.has(method)) return { ok: false, error: `${Z_PAYMENT_LABELS[method]} iki kez girilmiş` }
    if (amount < 0) return { ok: false, error: "Ödeme tutarı negatif olamaz" }
    seenMethods.add(method)
    paymentLines.push({ method, amount })
  }

  const ekuNo = String(body.ekuNo ?? "").replace(/\s+/g, "").toLocaleUpperCase("tr-TR")
  const note = String(body.note ?? "").trim()

  return {
    ok: true,
    data: {
      deviceId,
      zNo,
      takenAt,
      ekuNo: ekuNo ? ekuNo.slice(0, 40) : null,
      receiptCount,
      grossTotal,
      vatLines,
      paymentLines,
      cancelCount,
      cancelTotal,
      note: note ? note.slice(0, 1000) : null,
    },
  }
}

export type ZInternalIssue = { code: "VAT_SUM" | "PAYMENT_SUM" | "VAT_RATE"; message: string }

/**
 * Z'nin KENDİ içindeki tutarlılık. Kobipo'yla karşılaştırmadan bağımsızdır:
 * buradaki uyarı "yazarken yanlış girmiş olabilirsiniz" demektir.
 *
 * - Σ(matrah + KDV) = toplam — KDV satırı hiç girilmediyse sorulmaz.
 * - Σ ödeme = toplam — ödeme satırı hiç girilmediyse sorulmaz.
 * - Her satırda KDV ≈ matrah × oran (cihaz satır satır yuvarlar; 2 kuruş pay).
 */
export function zInternalChecks(z: Pick<ZReportFields, "grossTotal" | "vatLines" | "paymentLines">): ZInternalIssue[] {
  const issues: ZInternalIssue[] = []
  const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (z.vatLines.length > 0) {
    const sum = round2(z.vatLines.reduce((s, l) => s + l.base + l.vat, 0))
    if (Math.abs(sum - z.grossTotal) >= 0.01) {
      issues.push({
        code: "VAT_SUM",
        message: `KDV satırlarının toplamı (${fmt(sum)} ₺) Z toplamıyla (${fmt(z.grossTotal)} ₺) tutmuyor`,
      })
    }
    for (const line of z.vatLines) {
      const expected = round2((line.base * line.rate) / 100)
      if (Math.abs(expected - line.vat) > 0.02) {
        issues.push({
          code: "VAT_RATE",
          message: `%${line.rate} satırında KDV ${fmt(line.vat)} ₺ yazılmış; matraha göre ${fmt(expected)} ₺ olmalı`,
        })
      }
    }
  }

  if (z.paymentLines.length > 0) {
    const sum = round2(z.paymentLines.reduce((s, l) => s + l.amount, 0))
    if (Math.abs(sum - z.grossTotal) >= 0.01) {
      issues.push({
        code: "PAYMENT_SUM",
        message: `Ödeme satırlarının toplamı (${fmt(sum)} ₺) Z toplamıyla (${fmt(z.grossTotal)} ₺) tutmuyor`,
      })
    }
  }

  return issues
}

/** Veritabanındaki JSON sütunlarını güvenle okur (eski/bozuk kayıt ekranı düşürmesin). */
export function parseStoredVatLines(value: unknown): ZVatLine[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      const line = (raw ?? {}) as Record<string, unknown>
      return { rate: Number(line.rate), base: Number(line.base) || 0, vat: Number(line.vat) || 0 }
    })
    .filter((line) => Number.isFinite(line.rate))
}

export function parseStoredPaymentLines(value: unknown): ZPaymentLine[] {
  if (!Array.isArray(value)) return []
  return value
    .map((raw) => {
      const line = (raw ?? {}) as Record<string, unknown>
      return { method: String(line.method) as ZPaymentMethod, amount: Number(line.amount) || 0 }
    })
    .filter((line) => Z_PAYMENT_METHODS.includes(line.method))
}
