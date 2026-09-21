/**
 * Teklif tutar hesabının TEK kaynağı — satış ve satın alma teklif ekranları,
 * POST/PUT uçları ve teklif detayı hepsi buradan geçer.
 *
 * Neden ortak: hesap iki uçta ve istemcide ayrı ayrı yazılıydı. İskontoya bir
 * mod (yüzde/tutar) ya da genel iskonto eklemek üç kopyadan birini unutmaya
 * açıktı; ekranın gösterdiği toplamla kaydedilen toplam ayrışırdı.
 *
 * KURAL — iskontonun çözümü burada, dip toplam RESMÎ FATURAYLA aynı kaynaktan
 * (lib/invoice/document-totals.ts → GİB'e giden belgenin satır yuvarlamalı hesabı):
 *
 *   satır iskonto = PERCENT → brüt × oran/100      (oran 0–100'e kırpılır)
 *                   AMOUNT  → tutar                 (0–brüt'e kırpılır; SATIR toplamıdır, birim başı değil)
 *                   → kuruşa yuvarlanır (kaydedilen ve faturaya taşınan tutar)
 *   ara toplam    = Σ (brüt − satır iskontosu)
 *   genel iskonto = PERCENT → ara toplam × oran/100 (kuruşa yuvarlı)
 *                   AMOUNT  → tutar                 (0–ara toplam'a kırpılır)
 *   matrah/KDV/toplam → computeInvoiceTotals: genel iskonto satırlara dağıtılır,
 *                   her satır kuruşa yuvarlanır, toplam = matrah + KDV.
 *
 * Faturayla aynı olması şart: teklif faturaya dönüşünce `globalDiscountAmount`
 * faturaya taşınır ve belge bu hesapla GİB'e gider. Ayrı bir formül (ör. KDV'yi
 * toplamda oransal düşürmek) tekliften gelen faturayı 1–3 kuruş kaydırıyordu.
 *
 * BÖLÜM AYIRICI (`kind: "SECTION"`) hesabın DIŞINDADIR: satır sıfır sayılır ve
 * belge hesabına hiç verilmez. Sıfır satır olarak geçirmek bile yanlış olurdu —
 * genel iskontonun kuruş artığı SON satıra yazılıyor, son satır bir bölüm
 * başlığıysa o kuruş toplamdan düşerdi.
 *
 * Saf modüldür; istemcide de çalışır.
 */

import { computeLineTax } from "@/lib/invoice/line-tax"
import { computeInvoiceTotals, documentColumnPrecision } from "@/lib/invoice/document-totals"

export type DiscountMode = "PERCENT" | "AMOUNT"

/**
 * Satır tipi: fiyatlı kalem ya da BÖLÜM AYIRICI (başlık + açıklama taşıyan,
 * fiyatsız gruplama satırı).
 */
export type QuoteLineKind = "ITEM" | "SECTION"

/**
 * Bölüm ayırıcı mı? Tek ölçü budur — kalem okuyan her katman (hesap, editör,
 * PDF, faturaya dönüşüm) aynı soruyu buradan sorar. Eski kayıtlarda kolon
 * yoktur; `null`/boş değer fiyatlı kalem sayılır.
 */
export function isSectionLine(kind: unknown): boolean {
  return typeof kind === "string" && kind.toUpperCase() === "SECTION"
}

// Prisma Decimal da kabul edilir (kayıttan okunan değerler) — Number() onu çevirir.
type Num = number | string | null | undefined | { toString(): string }

const num = (v: Num) => {
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v)
  return Number.isFinite(n) ? n : 0
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export type QuoteLineInput = {
  quantity: Num
  unitPrice: Num
  vatRate: Num
  /** Verilmezse eski kayıt kuralıyla çıkarılır: bkz. `resolveDiscountMode`. */
  discountMode?: string | null
  discountRate?: Num
  discountAmount?: Num
  /** "SECTION" → bölüm ayırıcı: hesaba hiç girmez. Verilmezse fiyatlı kalem. */
  kind?: string | null
}

export type QuoteGlobalDiscountInput = {
  mode: string | null | undefined
  value: Num
}

/**
 * Satırın iskonto modu. Açık mod kazanır; yoksa (mod kolonundan önce yazılmış
 * kayıt, eski istemci) fatura editörüyle aynı çıkarım: oran yok ama tutar varsa
 * AMOUNT. AMOUNT kaydında oran bilerek NULL yazılır ki bu çıkarım tutsun.
 */
export function resolveDiscountMode(
  mode: string | null | undefined,
  rate: Num,
  amount: Num,
): DiscountMode {
  const m = typeof mode === "string" ? mode.toUpperCase() : ""
  if (m === "AMOUNT" || m === "PERCENT") return m
  return num(amount) > 0 && !(num(rate) > 0) ? "AMOUNT" : "PERCENT"
}

export type QuoteLineCalc = {
  mode: DiscountMode
  gross: number
  discount: number
  net: number
  vat: number
  total: number
  /** Kayda yazılacak oran: PERCENT'te oran, AMOUNT'ta null. */
  discountRate: number | null
}

/** Bölüm ayırıcının hesaptaki karşılığı: her ölçü sıfır, iskonto modu yok sayılır. */
const SECTION_CALC: QuoteLineCalc = {
  mode: "PERCENT",
  gross: 0,
  discount: 0,
  net: 0,
  vat: 0,
  total: 0,
  discountRate: null,
}

export function calcQuoteLineTotals(line: QuoteLineInput): QuoteLineCalc {
  // Bölüm ayırıcı fiyat taşımaz: kullanıcı eski bir kalemi bölüme çevirse bile
  // kalan miktar/fiyat değerleri toplama sızmasın diye BURADA sıfırlanır.
  if (isSectionLine(line.kind)) return SECTION_CALC

  // Kaydedilecek hassasiyette: miktar 2, birim fiyat 6, iskonto 2 ondalık.
  const gross =
    documentColumnPrecision.quantity(num(line.quantity)) * documentColumnPrecision.unitPrice(num(line.unitPrice))
  const mode = resolveDiscountMode(line.discountMode, line.discountRate, line.discountAmount)
  const rate = clamp(num(line.discountRate), 0, 100)
  const discount = documentColumnPrecision.amount(
    mode === "AMOUNT"
      ? gross > 0 ? clamp(num(line.discountAmount), 0, gross) : 0
      : gross * (rate / 100),
  )
  const net = gross - discount
  const tax = computeLineTax(net, { vatRate: num(line.vatRate) })
  return {
    mode,
    gross,
    discount,
    net,
    vat: tax.vat,
    total: tax.total,
    discountRate: mode === "PERCENT" ? rate : null,
  }
}

export type QuoteTotals = {
  /** Satır iskontoları öncesi Σ brüt. */
  gross: number
  /** Σ satır iskontosu. */
  lineDiscount: number
  /** Genel iskonto öncesi ara toplam (satır iskontoları düşülmüş). */
  subtotal: number
  globalDiscountMode: DiscountMode
  /** Uygulanan genel iskonto tutarı (kuruşa yuvarlı, ara toplamı aşmaz). */
  globalDiscount: number
  /** Kayda yazılacak genel iskonto oranı: PERCENT'te oran (>0), aksi halde null. */
  globalDiscountRate: number | null
  /** KDV matrahı. */
  net: number
  vat: number
  total: number
  lines: QuoteLineCalc[]
}

export function calcQuoteTotals(
  lines: QuoteLineInput[],
  globalDiscount?: QuoteGlobalDiscountInput | null,
): QuoteTotals {
  const calcs = lines.map(calcQuoteLineTotals)
  const gross = calcs.reduce((s, c) => s + c.gross, 0)
  const lineDiscount = calcs.reduce((s, c) => s + c.discount, 0)
  const subtotal = gross - lineDiscount

  const mode: DiscountMode =
    typeof globalDiscount?.mode === "string" && globalDiscount.mode.toUpperCase() === "AMOUNT"
      ? "AMOUNT"
      : "PERCENT"
  const raw = Math.max(0, num(globalDiscount?.value))
  const rate = mode === "PERCENT" && raw > 0 ? clamp(raw, 0, 100) : null
  // Kuruşa yuvarlanır: kayıt 2 ondalık tutar, fatura da o tutarı taşır.
  const requested =
    subtotal > 0
      ? Math.min(round2(mode === "AMOUNT" ? clamp(raw, 0, subtotal) : subtotal * ((rate ?? 0) / 100)), subtotal)
      : 0

  // Bölüm ayırıcılar belgeye HİÇ verilmez (sıfır satır olarak da değil): genel
  // iskonto satırlara dağıtılırken kuruş artığı SON satıra yazılır ve son satır
  // bir bölüm başlığıysa o artık toplamdan sessizce düşerdi.
  const totals = computeInvoiceTotals(
    lines.flatMap((line, i) =>
      isSectionLine(line.kind)
        ? []
        : [
            {
              quantity: documentColumnPrecision.quantity(num(line.quantity)),
              unitPrice: documentColumnPrecision.unitPrice(num(line.unitPrice)),
              vatRate: num(line.vatRate),
              discountAmount: calcs[i].discount,
            },
          ],
    ),
    { globalDiscountAmount: requested },
  )

  return {
    gross,
    lineDiscount,
    subtotal,
    globalDiscountMode: mode,
    globalDiscount: totals.globalDiscount,
    globalDiscountRate: rate,
    net: totals.net,
    vat: totals.vat,
    total: totals.total,
    lines: calcs,
  }
}

/** Kayıttaki iki kolondan ekranın mod/değer çiftini geri kurar. */
export function globalDiscountFromRecord(record: {
  globalDiscountRate?: Num
  globalDiscountAmount?: Num
}): { mode: DiscountMode; value: number } | null {
  const rate = num(record.globalDiscountRate)
  if (rate > 0) return { mode: "PERCENT", value: rate }
  const amount = num(record.globalDiscountAmount)
  if (amount > 0) return { mode: "AMOUNT", value: amount }
  return null
}
