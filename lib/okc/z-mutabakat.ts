// Z raporu ↔ Kobipo fişleri karşılaştırması — SAF, TEK YER.
// Plan: docs/okc/ASAMA1-KOBIPO.md A3. Veritabanı tarafı: lib/okc/z-mutabakat-query.ts
//
// Üç eksen: TOPLAM, KDV ORANI (matrah + KDV = brüt), ÖDEME TİPİ. Fark ≥ 0,01 ₺
// her eksende ayrı satır olarak görünür — sessiz geçilmez.
//
// GÜN SINIRI Z'dir, takvim günü DEĞİL: bir Z'nin fişleri aynı cihazın önceki
// Z'sinden bu Z'ye kadar kesilenlerdir. Gece 02:00'de kapanan kafenin cirosu
// böylece iki takvim gününe bölünmez. Cihazın ilk Z'sinde önceki Z yoktur;
// pencere o günün (İstanbul) başından açılır ve ekran bunu söyler.

import type { ZPaymentLine, ZPaymentMethod, ZVatLine } from "@/lib/okc/z-report"
import { Z_PAYMENT_LABELS } from "@/lib/okc/z-report"

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Türkiye 2016'dan beri sabit UTC+3 (yaz saati yok). */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000

/** Verilen anın İstanbul takvim gününün başlangıcı (00:00 +03:00), UTC Date olarak. */
export function istanbulDayStart(at: Date): Date {
  const local = new Date(at.getTime() + ISTANBUL_OFFSET_MS)
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  return new Date(midnightLocal - ISTANBUL_OFFSET_MS)
}

export type ZWindow = { start: Date; end: Date; first: boolean }

/**
 * Z'nin fiş penceresi: (önceki Z, bu Z]. Başlangıç HARİÇ, bitiş DAHİL — önceki
 * Z ile aynı saniyede kesilen fiş iki Z'ye birden sayılmasın.
 */
export function resolveZWindow(takenAt: Date, previousTakenAt: Date | null): ZWindow {
  if (previousTakenAt && previousTakenAt < takenAt) {
    return { start: previousTakenAt, end: takenAt, first: false }
  }
  return { start: istanbulDayStart(takenAt), end: takenAt, first: true }
}

/**
 * Gün sonu raporunda "bu günün Z'si" hangisi? Z gece yarısından SONRA da alınır
 * (kafe 02:00'de kapanır). İş günü kesimi 06:00'dır: 06:00'dan önce alınan Z
 * önceki güne sayılır. YALNIZ listeleme içindir — mutabakatın kendisi gerçek
 * pencereyi (önceki Z → bu Z) kullanır, bu kesimi değil.
 */
export const Z_BUSINESS_DAY_CUTOFF_HOURS = 6

export function zBusinessRange(start: Date, end: Date): { start: Date; end: Date } {
  const shift = Z_BUSINESS_DAY_CUTOFF_HOURS * 60 * 60 * 1000
  return { start: new Date(start.getTime() + shift), end: new Date(end.getTime() + shift) }
}

export type MutabakatReceipt = {
  id: string
  invoiceNo: string
  date: Date
  /** `Invoice.totalAmount` — fişin ödenecek tutarı. */
  total: number
  /** Satır iskontosu SONRASI net (KDV hariç) tutarlar. */
  lines: Array<{ vatRate: number; net: number }>
  globalDiscount: number
  globalCharge: number
  payments: Array<{ method: string; amount: number; date: Date }>
}

/**
 * Kobipo tahsilat yöntemi → Z ödeme tipi. Bakiye kapama (WRITE_OFF) tahsilat
 * değildir, null döner: fişin kapatılan kısmı açık hesapta kalmış sayılır —
 * cihazda da öyle görünmüştür.
 */
export function kobipoMethodToZ(method: string): ZPaymentMethod | null {
  switch (method) {
    case "CASH":
      return "CASH"
    case "CREDIT_CARD":
      return "CREDIT_CARD"
    case "MEAL_CARD":
      return "MEAL_CARD"
    case "WRITE_OFF":
      return null
    default:
      return "OTHER"
  }
}

/**
 * Fişin brüt tutarının KDV oranlarına dağılımı (yuvarlanmamış). Toplamı fişin
 * `total`ine EŞİTTİR: genel iskonto/ilave oranlara orantılı dağılır (cihaz da
 * fiş altı indirimi KDV gruplarına böyle dağıtır), kalan kuruş (yuvarlama) da
 * aynı oranla emilir. Böylece oran ekseninin toplamı toplam eksenini tutar.
 */
export function receiptGrossByRate(receipt: MutabakatReceipt): Map<number, number> {
  const netByRate = new Map<number, number>()
  for (const line of receipt.lines) {
    netByRate.set(line.vatRate, (netByRate.get(line.vatRate) ?? 0) + line.net)
  }
  const subtotal = [...netByRate.values()].reduce((s, v) => s + v, 0)
  const result = new Map<number, number>()
  if (subtotal <= 0) return result

  const factor = (subtotal - receipt.globalDiscount + receipt.globalCharge) / subtotal
  let grossSum = 0
  for (const [rate, net] of netByRate) {
    const gross = net * factor * (1 + rate / 100)
    result.set(rate, gross)
    grossSum += gross
  }
  if (grossSum > 0 && receipt.total > 0) {
    const scale = receipt.total / grossSum
    for (const [rate, gross] of result) result.set(rate, gross * scale)
  }
  return result
}

/**
 * Fişin Z anına kadarki tahsilatı, Z ödeme tiplerine göre. Z'den SONRA yapılan
 * tahsilat (dünkü veresiyenin bugün ödenmesi) bu Z'de açık hesaptır — cihaz da
 * satışı o gün açık hesap olarak kaydetmiştir. Ödenmeyen kalan AÇIK HESAP'tır.
 */
export function receiptPaymentsByMethod(
  receipt: MutabakatReceipt,
  until: Date,
): Map<ZPaymentMethod, number> {
  const result = new Map<ZPaymentMethod, number>()
  let paid = 0
  for (const payment of receipt.payments) {
    if (payment.date > until) continue
    const method = kobipoMethodToZ(payment.method)
    if (!method) continue
    result.set(method, (result.get(method) ?? 0) + payment.amount)
    paid += payment.amount
  }
  const open = round2(receipt.total - paid)
  if (open > 0) result.set("OPEN_ACCOUNT", (result.get("OPEN_ACCOUNT") ?? 0) + open)
  return result
}

export type MutabakatRow = {
  key: string
  label: string
  /** Z'de yazan; Z bu ekseni hiç girmediyse null (karşılaştırma yok). */
  z: number | null
  kobipo: number
  /** z − kobipo; karşılaştırma yoksa null. */
  diff: number | null
  ok: boolean
}

export type Mutabakat = {
  total: MutabakatRow
  receiptCount: { z: number | null; kobipo: number; diff: number | null; ok: boolean }
  vat: MutabakatRow[]
  payments: MutabakatRow[]
  /** Genel iskontolu fiş var: oran dağılımı hesaplanmış, kuruş farkı buradan doğabilir. */
  hasAllocatedDiscount: boolean
  ok: boolean
}

function row(key: string, label: string, z: number | null, kobipo: number): MutabakatRow {
  const k = round2(kobipo)
  if (z === null) return { key, label, z: null, kobipo: k, diff: null, ok: true }
  const diff = round2(z - k)
  return { key, label, z: round2(z), kobipo: k, diff, ok: Math.abs(diff) < 0.005 }
}

export type ZSide = {
  grossTotal: number
  receiptCount: number | null
  vatLines: ZVatLine[]
  paymentLines: ZPaymentLine[]
}

/**
 * Karşılaştırma. `until` = Z'nin alındığı an (ödeme ekseni için).
 *
 * KDV ve ödeme eksenleri yalnız Z'de o eksen GİRİLDİYSE karşılaştırılır; girilmediyse
 * Kobipo'nun kırılımı yine gösterilir (z = null), ama fark üretmez. Z'de satırı
 * olmayan oran/ödeme tipi o eksen girilmişse 0 kabul edilir (cihaz o gruba satış
 * yazmamıştır).
 */
export function compareZ(z: ZSide, receipts: MutabakatReceipt[], until: Date): Mutabakat {
  const kobipoTotal = receipts.reduce((s, r) => s + r.total, 0)

  const grossByRate = new Map<number, number>()
  const byMethod = new Map<ZPaymentMethod, number>()
  let hasAllocatedDiscount = false
  for (const receipt of receipts) {
    if (receipt.globalDiscount > 0 || receipt.globalCharge > 0) hasAllocatedDiscount = true
    for (const [rate, gross] of receiptGrossByRate(receipt)) {
      grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + gross)
    }
    for (const [method, amount] of receiptPaymentsByMethod(receipt, until)) {
      byMethod.set(method, (byMethod.get(method) ?? 0) + amount)
    }
  }

  const vatEntered = z.vatLines.length > 0
  const zVat = new Map(z.vatLines.map((l) => [l.rate, l.base + l.vat]))
  const rates = [...new Set([...grossByRate.keys(), ...zVat.keys()])].sort((a, b) => a - b)
  const vat = rates.map((rate) =>
    row(`vat:${rate}`, `%${rate} KDV'li satış`, vatEntered ? (zVat.get(rate) ?? 0) : null, grossByRate.get(rate) ?? 0),
  )

  const paymentsEntered = z.paymentLines.length > 0
  const zPay = new Map(z.paymentLines.map((l) => [l.method, l.amount]))
  const methodOrder: ZPaymentMethod[] = ["CASH", "CREDIT_CARD", "MEAL_CARD", "OPEN_ACCOUNT", "OTHER"]
  const methods = methodOrder.filter((m) => byMethod.has(m) || zPay.has(m))
  const payments = methods.map((method) =>
    row(
      `pay:${method}`,
      Z_PAYMENT_LABELS[method],
      paymentsEntered ? (zPay.get(method) ?? 0) : null,
      byMethod.get(method) ?? 0,
    ),
  )

  const total = row("total", "Toplam satış", z.grossTotal, kobipoTotal)
  const countDiff = z.receiptCount === null ? null : z.receiptCount - receipts.length
  const receiptCount = { z: z.receiptCount, kobipo: receipts.length, diff: countDiff, ok: !countDiff }

  const ok = total.ok && receiptCount.ok && vat.every((r) => r.ok) && payments.every((r) => r.ok)
  return { total, receiptCount, vat, payments, hasAllocatedDiscount, ok }
}
