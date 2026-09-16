import { calcQuoteTotals, type QuoteGlobalDiscountInput } from "@/lib/teklif/quote-totals"

/**
 * İstek gövdesinden teklif KAYDI: kalem satırları + başlık toplamları.
 *
 * POST ve PUT uçları bunu paylaşır; öncesinde ikisinde de aynı `calculateTotals`
 * kopyası duruyordu. Hesabın kendisi `quote-totals.ts`tedir — burası yalnız
 * gövdeyi normalize edip kolonlara döker.
 */

export function buildQuoteRecord(items: any[], globalDiscount: QuoteGlobalDiscountInput | null) {
  const valid = (Array.isArray(items) ? items : []).filter(
    (item) => item?.description && String(item.description).trim(),
  )
  const totals = calcQuoteTotals(valid, globalDiscount)

  const normalized = valid.map((item, index) => {
    const c = totals.lines[index]
    const note = item.note != null ? String(item.note).trim() : ""
    return {
      productId: item.productId || null,
      description: String(item.description).trim(),
      note: note || null,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      // Tutar modunda oran NULL: mod kayıttan bu boşlukla okunur (resolveDiscountMode).
      discountRate: c.discountRate,
      discountAmount: c.discount,
      vatRate: Number(item.vatRate || 0),
      vatAmount: c.vat,
      totalAmount: c.total,
    }
  })

  return {
    normalized,
    netAmount: totals.net,
    vatAmount: totals.vat,
    totalAmount: totals.total,
    globalDiscountRate: totals.globalDiscountRate,
    globalDiscountAmount: totals.globalDiscount > 0 ? totals.globalDiscount : null,
  }
}

/** Gövdedeki `globalDiscount` alanı: `{ mode, value }`, null (kaldır) ya da hiç yok (undefined). */
export function parseGlobalDiscount(raw: any): QuoteGlobalDiscountInput | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || typeof raw !== "object") return null
  return { mode: raw.mode, value: raw.value }
}
