/**
 * Fatura DİP TOPLAMLARININ tek kaynağı — GİB'e giden belgeyle kuruşu kuruşuna aynı.
 *
 * NEDEN: Kobipo toplamı satırların yuvarlanmamış toplamından kurup en sonda
 * yuvarlıyordu (lib/invoice/line-tax.ts), Mysoft'a giden belge ise HER SATIRI
 * ayrı kuruşa yuvarlıyor ve genel iskontoyu satırlara dağıtıyor. 2026-09-16
 * ölçümü: 2.000 rastgele faturanın %38'inde 1–3 kuruş fark (iskontosuz olanların
 * da %39'unda); Reypo'da gerçek taslak UBL'de Kobipo 31.906,38 ↔ belge 31.906,39.
 * Gönderimden sonra tutar Mysoft'tan geri okunmadığı için fark cari bakiyede kalıyordu.
 *
 * Çözüm iki kuralı tek yere toplamak:
 *
 *  1. `computeDocumentTotals` — resmî belge hesabı. Mysoft sağlayıcısı payload'ı
 *     BUNDAN kurar (mysoft-provider.ts), editör/uçlar/teklif de bunu kaydeder.
 *     Adımlar (hepsi kuruşa yuvarlı):
 *       brüt      = miktar × birim fiyat
 *       iskonto   = min(satır iskontosu, brüt)
 *       genel pay = (satır neti / ara toplam) × genel iskonto   → son satır artığı alır
 *       ilave pay = aynı dağıtım, matrahı ARTIRIR
 *       matrah    = brüt − iskonto − genel pay + ilave pay
 *       ÖTV/diğer = matrah × oran
 *       KDV matr. = matrah + ÖTV + (matraha giren diğer vergi) + maktu GEKAP
 *       KDV       = KDV matrahı × oran
 *       tevkifat  = KDV × oran
 *     Dip toplamlar satır değerlerinin toplamıdır; ödenecek = vergiler dahil −
 *     tevkifat + dip toplam yuvarlaması.
 *
 *  2. FİŞ (`Invoice.isReceipt`) bu kurala GEÇMEZ. Fiş kasa toplamıdır, GİB belgesi
 *     değildir; KDV dahil fiyatla satan kafede satır yuvarlaması ekrandaki
 *     fiyattan sapıyordu (20.000 örnekte 2.318 fiş; bugünkü toplam kuralında 0).
 *     Fişler `computeInvoiceTotals(..., { receipt: true })` ile eski kuralda kalır;
 *     fişler faturaya birleştirilirken fark dip toplam yuvarlamasıyla kapatılır
 *     (app/api/fisler/faturaya-donustur).
 *
 * Saf modüldür; istemcide de çalışır.
 */

import {
  addLineTax,
  applyGlobalAdjustment,
  computeLineTax,
  emptyLineTaxSums,
} from "@/lib/invoice/line-tax"
import { isOtherTaxCharge, isOtherTaxInVatBase } from "@/lib/integrations/e-invoice/gib-tax-types"

// GİB şematronu: tutarlar en fazla 2 ondalık. Sağlayıcının yuvarlamasıyla BİREBİR
// aynı ifade — Number.EPSILON eklemek bazı .xx5 değerlerde sonucu değiştirir.
const round2 = (n: number) => Math.round(n * 100) / 100

const trimOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

export type DocumentLineInput = {
  quantity?: number | string | null
  unitPrice?: number | string | null
  vatRate?: number | string | null
  /** Satır iskontosu TUTARI (moddan çözülmüş). Brütü aşan/negatif değer kırpılır. */
  discountAmount?: number | string | null
  /** Yalnız UBL'deki oran alanı için; tutarı etkilemez. */
  discountRate?: number | string | null
  exciseRate?: number | string | null
  exciseCode?: string | null
  otherTaxRate?: number | string | null
  otherTaxCode?: string | null
  otherTaxName?: string | null
  withholdingRate?: number | string | null
  withholdingCode?: string | null
  withholdingName?: string | null
  gekapUnitAmount?: number | string | null
  taxExemptionReasonCode?: string | null
  taxExemptionReason?: string | null
}

export type DocumentAdjustments = {
  globalDiscountAmount?: number | string | null
  globalChargeAmount?: number | string | null
  payableRoundingAmount?: number | string | null
}

export type DocumentOptions = {
  /**
   * Tutarı sıfır/negatif satırları belgeden çıkar. Mysoft'a gönderimde AÇIK
   * (sıfır tutarlı kalem gönderilmiyor). Kobipo kaydında kapalı: alış
   * faturasındaki eksi satırlar toplamdan düşmesin.
   */
  skipNonPositiveLines?: boolean
  /**
   * Tevkifat yalnız GİB kodu varsa sayılır. Gönderimde AÇIK (kodsuz tevkifat
   * belgeye yazılamaz). Kobipo kaydında kapalı: kodu okunamamış gelen faturanın
   * tevkifatı toplamdan düşmeye devam etsin.
   */
  withholdingNeedsCode?: boolean
}

export type DocumentLine<T> = {
  /** Girdi dizisindeki sıra (satır elendiyse atlanır). */
  index: number
  item: T
  qty: number
  unitPrice: number
  vatRate: number
  /** Brüt, kuruşa yuvarlı. */
  rowTotal: number
  /** Satır iskontosu, kuruşa yuvarlı. */
  lineDiscount: number
  discountRate: number
  exemptionCode: string | null
  exemptionReason: string | null
  withholdingCode: string | null
  withholdingName: string | null
  withholdingRate: number
  /** Satırın tevkifat tutarı (kodu yoksa ve `withholdingNeedsCode` açıksa 0). */
  withholding: number
  exciseRate: number
  exciseCode: string | null
  /** Maktu GEKAP varken oransal GEKAP susar → 0'a çekilir. */
  otherTaxRate: number
  otherTaxName: string | null
  otherTaxCode: string | null
  otherTaxInVatBase: boolean
  otherTaxIsCharge: boolean
  gekap: number
  /** Genel iskontodan düşen pay (ilave varsa ondan eksiltilmiş hâli; negatif olabilir). */
  globalShare: number
  /** Mal/hizmet matrahı: brüt − iskonto − genel pay (+ ilave). */
  taxable: number
  excise: number
  otherTax: number
  vatBase: number
  rowVat: number
}

/** Mysoft `invoiceCalculation` alanlarının birebir karşılığı. */
export type DocumentCalculation = {
  lineExtensionAmount: number
  taxExclusiveAmount: number
  taxInclusiveAmount: number
  allowanceTotalAmount: number
  chargeTotalAmount: number
  payableRoundingAmount: number
  payableAmount: number
}

export type DocumentTotals<T> = {
  lines: DocumentLine<T>[]
  calculation: DocumentCalculation
  /** Uygulanan genel iskonto (ara toplamla kırpılmış, kuruşa yuvarlı). */
  globalDiscount: number
  /** Uygulanan fatura altı ilave, kuruşa yuvarlı. */
  globalCharge: number
  /** Genel iskonto/ilave ÖNCESİ ara toplam (satır iskontoları düşülmüş). */
  subtotal: number
}

const num = (v: unknown) => Number(v) || 0

export function computeDocumentTotals<T extends DocumentLineInput>(
  items: T[],
  adjustments: DocumentAdjustments = {},
  options: DocumentOptions = {},
): DocumentTotals<T> {
  const lines: DocumentLine<T>[] = items
    .map((item, index) => {
      const qty = num(item.quantity)
      const unitPrice = num(item.unitPrice)
      const rowTotal = qty * unitPrice
      const lineDiscount = Math.max(0, Math.min(num(item.discountAmount), rowTotal))
      const otherTaxCode = trimOrNull(item.otherTaxCode)
      const gekapUnitAmount = Math.max(0, num(item.gekapUnitAmount))
      return {
        index,
        item,
        qty,
        unitPrice,
        vatRate: num(item.vatRate),
        rowTotal,
        lineDiscount,
        discountRate: num(item.discountRate),
        exemptionCode: trimOrNull(item.taxExemptionReasonCode),
        exemptionReason: trimOrNull(item.taxExemptionReason),
        withholdingCode: trimOrNull(item.withholdingCode),
        withholdingName: trimOrNull(item.withholdingName),
        withholdingRate: num(item.withholdingRate),
        withholding: 0,
        exciseRate: num(item.exciseRate),
        exciseCode: trimOrNull(item.exciseCode),
        otherTaxRate: num(item.otherTaxRate),
        otherTaxName: trimOrNull(item.otherTaxName),
        otherTaxCode,
        otherTaxInVatBase: isOtherTaxInVatBase(otherTaxCode),
        otherTaxIsCharge: isOtherTaxCharge(otherTaxCode),
        // Maktu GEKAP: miktar × birim tutar. İskonto (satır ya da genel) onu küçültmez.
        gekap: round2(qty * gekapUnitAmount),
        globalShare: 0,
        taxable: rowTotal - lineDiscount,
        excise: 0,
        otherTax: 0,
        vatBase: 0,
        rowVat: 0,
      }
    })
    .filter((l) => !options.skipNonPositiveLines || l.rowTotal > 0)

  // Genel iskonto satırlara ORANTILI yayılır; kuruş artığı son satıra gider.
  // Belge dizaynları başlık seviyesindeki iskontoyu her zaman basmıyor, satıra
  // yayılmış iskonto ise her UBL XSLT'inde görünür ve KDV doğru çıkar.
  const subtotal = lines.reduce((s, l) => s + (l.rowTotal - l.lineDiscount), 0)
  const rawGlobalDiscount = num(adjustments.globalDiscountAmount)
  const appliedGlobalDiscount =
    subtotal > 0 ? Math.max(0, Math.min(rawGlobalDiscount, subtotal)) : 0
  if (appliedGlobalDiscount > 0 && subtotal > 0) {
    let distributed = 0
    lines.forEach((l, idx) => {
      const lineNet = l.rowTotal - l.lineDiscount
      const isLast = idx === lines.length - 1
      const share = isLast
        ? round2(Math.max(0, appliedGlobalDiscount - distributed))
        : round2((lineNet / subtotal) * appliedGlobalDiscount)
      l.globalShare = share
      distributed += share
    })
  }

  // Fatura altı İLAVE: iskontonun tersi, aynı dağıtım; pay NEGATİF eklenir.
  const rawGlobalCharge = Math.max(0, num(adjustments.globalChargeAmount))
  const globalCharge = rawGlobalCharge > 0 && subtotal > 0 ? round2(rawGlobalCharge) : 0
  const rounding = round2(num(adjustments.payableRoundingAmount))
  if (rawGlobalCharge > 0 && subtotal > 0) {
    let distributedCharge = 0
    lines.forEach((l, idx) => {
      const lineNet = l.rowTotal - l.lineDiscount
      const isLast = idx === lines.length - 1
      const share = isLast
        ? round2(Math.max(0, rawGlobalCharge - distributedCharge))
        : round2((lineNet / subtotal) * rawGlobalCharge)
      l.globalShare = round2(l.globalShare - share)
      distributedCharge += share
    })
  }

  lines.forEach((l) => {
    l.taxable = round2(l.rowTotal - l.lineDiscount - l.globalShare)
    l.excise = l.exciseRate > 0 ? round2((l.taxable * l.exciseRate) / 100) : 0
    // Maktu GEKAP girildiyse oransal GEKAP susar (line-tax.ts ile aynı kural).
    if (l.gekap > 0 && l.otherTaxIsCharge) l.otherTaxRate = 0
    l.otherTax = l.otherTaxRate > 0 ? round2((l.taxable * l.otherTaxRate) / 100) : 0
    l.vatBase = round2(l.taxable + l.excise + (l.otherTaxInVatBase ? l.otherTax : 0) + l.gekap)
    l.rowVat = round2((l.vatBase * l.vatRate) / 100)
    l.lineDiscount = round2(l.lineDiscount)
    l.rowTotal = round2(l.rowTotal)
    const withholds =
      l.withholdingRate > 0 && l.rowVat > 0 && (!options.withholdingNeedsCode || Boolean(l.withholdingCode))
    l.withholding = withholds ? round2((l.rowVat * l.withholdingRate) / 100) : 0
  })

  // GEKAP ve masraf türü diğer vergi UBL'de VERGİ değil masraftır: vergiler hariç
  // tutarın İÇİNDE durur. ÖTV/ÖİV/konaklama vergidir → vergiler dahil tutara eklenir.
  const totalGross = round2(lines.reduce((s, l) => s + l.rowTotal, 0))
  const totalLineCharge = round2(
    lines.reduce((s, l) => s + l.gekap + (l.otherTaxIsCharge ? l.otherTax : 0), 0),
  )
  const totalTaxable = round2(lines.reduce((s, l) => s + l.taxable, 0) + totalLineCharge)
  const totalVat = round2(lines.reduce((s, l) => s + l.rowVat, 0))
  const totalExtraTax = round2(
    lines.reduce((s, l) => s + l.excise + (l.otherTaxIsCharge ? 0 : l.otherTax), 0),
  )
  const totalWithholding = round2(lines.reduce((s, l) => s + l.withholding, 0))
  const taxInclusiveTotal = round2(totalTaxable + totalVat + totalExtraTax)

  return {
    lines,
    calculation: {
      lineExtensionAmount: totalGross,
      taxExclusiveAmount: totalTaxable,
      taxInclusiveAmount: taxInclusiveTotal,
      // İlave satırlara yayıldığı için matrahın İÇİNDE; iskonto brüt farkından
      // türetilirken geri eklenmezse olduğundan az görünür (GİB kontrolü tutmaz).
      allowanceTotalAmount: round2(totalGross - totalTaxable + globalCharge + totalLineCharge),
      chargeTotalAmount: round2(globalCharge + totalLineCharge),
      payableRoundingAmount: rounding,
      payableAmount: round2(taxInclusiveTotal - totalWithholding + rounding),
    },
    globalDiscount: round2(appliedGlobalDiscount),
    globalCharge,
    subtotal,
  }
}

/* ------------------------------------------------------------------------ */

export type InvoiceTotalsLine = DocumentLineInput

/** Kaydedilen/gösterilen fatura başlığı. İki kural da AYNI şekli döndürür. */
export type InvoiceTotals = {
  /** Satır iskontoları öncesi Σ brüt. */
  gross: number
  /** Σ satır iskontosu. */
  lineDiscount: number
  /** Genel iskonto/ilave öncesi ara toplam. */
  subtotal: number
  globalDiscount: number
  globalCharge: number
  rounding: number
  /** Mal/hizmet matrahı (ÖTV/GEKAP hariç) — `Invoice.netAmount`. */
  net: number
  /** KDV'nin hesaplandığı matrah (net + ÖTV + GEKAP). */
  vatBase: number
  vat: number
  excise: number
  otherTax: number
  otherTaxInBase: number
  gekap: number
  withholding: number
  /** Ödenecek — `Invoice.totalAmount`. */
  total: number
}

/**
 * Faturanın dip toplamı. `receipt: true` FİŞ kuralıdır (yuvarlamasız toplam,
 * bkz. dosya başı); aksi halde GİB belgesiyle aynı satır yuvarlamalı hesap.
 *
 * `discountAmount` moddan çözülmüş satır iskontosu tutarıdır
 * (`resolveLineDiscount`).
 */
export function computeInvoiceTotals(
  items: InvoiceTotalsLine[],
  adjustments: DocumentAdjustments,
  options: { receipt?: boolean } = {},
): InvoiceTotals {
  if (options.receipt) return receiptTotals(items, adjustments)

  const doc = computeDocumentTotals(items, adjustments)
  const sum = (pick: (l: DocumentLine<InvoiceTotalsLine>) => number) =>
    round2(doc.lines.reduce((s, l) => s + pick(l), 0))
  return {
    gross: doc.calculation.lineExtensionAmount,
    lineDiscount: sum((l) => l.lineDiscount),
    subtotal: round2(doc.subtotal),
    globalDiscount: doc.globalDiscount,
    globalCharge: doc.globalCharge,
    rounding: doc.calculation.payableRoundingAmount,
    net: sum((l) => l.taxable),
    vatBase: sum((l) => l.vatBase),
    vat: sum((l) => l.rowVat),
    excise: sum((l) => l.excise),
    otherTax: sum((l) => l.otherTax),
    otherTaxInBase: sum((l) => (l.otherTaxInVatBase ? l.otherTax : 0)),
    gekap: sum((l) => l.gekap),
    withholding: sum((l) => l.withholding),
    total: doc.calculation.payableAmount,
  }
}

/** FİŞ kuralı: satırlar yuvarlanmadan toplanır, genel iskonto oransal ölçeklenir. */
function receiptTotals(items: InvoiceTotalsLine[], adjustments: DocumentAdjustments): InvoiceTotals {
  const sums = emptyLineTaxSums()
  let gross = 0
  let lineDiscount = 0
  for (const item of items) {
    const rowTotal = num(item.quantity) * num(item.unitPrice)
    const discount = Math.max(0, Math.min(num(item.discountAmount), rowTotal))
    gross += rowTotal
    lineDiscount += discount
    const net = rowTotal - discount
    addLineTax(sums, net, computeLineTax(net, {
      vatRate: num(item.vatRate),
      exciseRate: num(item.exciseRate),
      otherTaxRate: num(item.otherTaxRate),
      otherTaxCode: item.otherTaxCode,
      withholdingRate: num(item.withholdingRate),
      quantity: num(item.quantity),
      gekapUnitAmount: num(item.gekapUnitAmount),
    }))
  }
  const subtotal = sums.net
  const globalDiscount = subtotal > 0 ? Math.min(Math.max(0, num(adjustments.globalDiscountAmount)), subtotal) : 0
  const globalCharge = Math.max(0, num(adjustments.globalChargeAmount))
  const adj =
    subtotal > 0 && (globalDiscount > 0 || globalCharge > 0)
      ? applyGlobalAdjustment(sums, subtotal - globalDiscount + globalCharge)
      : sums
  const rounding = num(adjustments.payableRoundingAmount)
  return {
    gross,
    lineDiscount,
    subtotal,
    globalDiscount,
    globalCharge,
    rounding,
    net: adj.net,
    vatBase: adj.vatBase,
    vat: adj.vat,
    excise: adj.excise,
    otherTax: adj.otherTax,
    otherTaxInBase: adj.otherTaxInBase,
    gekap: adj.gekap,
    withholding: adj.withholding,
    total: adj.total + rounding,
  }
}

/**
 * KAYITLI kalemlerden (Prisma satırları: Decimal/null alanlar) resmî belge toplamı.
 * Sipariş/teklif/fiş → fatura dönüşümleri başlığı kopyalamak yerine bunu kullanır.
 *
 * Satır iskontosu KAYITLI TUTARDIR: Mysoft sağlayıcısı belgeye `discountAmount`
 * kolonunu yazar, orandan yeniden türetmez. Burada orandan türetmek .xx5'te
 * (Postgres yukarı, JS aşağı yuvarlar) başlığı belgeden bir kuruş ayırırdı.
 * Oran yalnız tutar kolonu boş olan eski kayıtlarda devreye girer.
 */
export function invoiceTotalsFromStoredItems(
  items: Array<{
    quantity: unknown
    unitPrice: unknown
    vatRate: unknown
    discountRate?: unknown
    discountAmount?: unknown
    exciseRate?: unknown
    exciseCode?: string | null
    otherTaxRate?: unknown
    otherTaxCode?: string | null
    otherTaxName?: string | null
    withholdingRate?: unknown
    withholdingCode?: string | null
    gekapUnitAmount?: unknown
  }>,
  adjustments: { globalDiscountAmount?: unknown; globalChargeAmount?: unknown; payableRoundingAmount?: unknown } = {},
): InvoiceTotals {
  return computeInvoiceTotals(
    items.map((item) => ({
      quantity: num(item.quantity),
      unitPrice: num(item.unitPrice),
      vatRate: num(item.vatRate),
      discountAmount: round2(
        item.discountAmount == null
          ? resolveLineDiscount({
              quantity: num(item.quantity),
              unitPrice: num(item.unitPrice),
              discountMode: "PERCENT",
              discountRate: num(item.discountRate),
            })
          : Math.max(0, Math.min(num(item.discountAmount), num(item.quantity) * num(item.unitPrice))),
      ),
      exciseRate: num(item.exciseRate),
      exciseCode: item.exciseCode ?? null,
      otherTaxRate: num(item.otherTaxRate),
      otherTaxCode: item.otherTaxCode ?? null,
      otherTaxName: item.otherTaxName ?? null,
      withholdingRate: num(item.withholdingRate),
      withholdingCode: item.withholdingCode ?? null,
      gekapUnitAmount: num(item.gekapUnitAmount),
    })),
    {
      globalDiscountAmount: num(adjustments.globalDiscountAmount),
      globalChargeAmount: num(adjustments.globalChargeAmount),
      payableRoundingAmount: num(adjustments.payableRoundingAmount),
    },
  )
}

/**
 * Kaydedilecek değeri KOLON hassasiyetine getirir (InvoiceItem: miktar 2, birim
 * fiyat 6, tutarlar 2 ondalık). Resmî belgede toplam bu değerlerden hesaplanıp
 * AYNEN yazılır; yuvarlamayı veritabanına bırakmak (Postgres .xx5'i JS'ten farklı
 * yuvarlar) kaydedilen kalemle hesaplanan toplamı ayırabilirdi. Fişte değer olduğu
 * gibi döner — fiş kuralı değişmedi.
 */
export const documentColumnPrecision = {
  quantity: (value: number, receipt = false) => (receipt ? value : round2(value)),
  unitPrice: (value: number, receipt = false) => (receipt ? value : Math.round(value * 1_000_000) / 1_000_000),
  amount: (value: number, receipt = false) => (receipt ? value : round2(value)),
}

/** Satır iskontosu tutarı: tutar modunda 0–brüt arası, yüzde modunda brüt × oran. */
export function resolveLineDiscount(item: {
  quantity?: number | string | null
  unitPrice?: number | string | null
  discountMode?: string | null
  discountRate?: number | string | null
  discountAmount?: number | string | null
}): number {
  const gross = num(item.quantity) * num(item.unitPrice)
  const mode =
    item.discountMode ?? (num(item.discountAmount) > 0 && !(num(item.discountRate) > 0) ? "AMOUNT" : "PERCENT")
  if (String(mode).toUpperCase() === "AMOUNT") return Math.max(0, Math.min(num(item.discountAmount), gross))
  return gross * (num(item.discountRate) / 100)
}
