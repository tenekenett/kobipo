import {
  calcQuoteTotals,
  isSectionLine,
  type QuoteGlobalDiscountInput,
} from "@/lib/teklif/quote-totals"

/**
 * İstek gövdesinden teklif KAYDI: kalem satırları + başlık toplamları.
 *
 * POST ve PUT uçları bunu paylaşır; öncesinde ikisinde de aynı `calculateTotals`
 * kopyası duruyordu. Hesabın kendisi `quote-totals.ts`tedir — burası yalnız
 * gövdeyi normalize edip kolonlara döker.
 */

const text = (v: unknown) => (v == null ? "" : String(v).trim())

/**
 * Satır kayda girecek mi? Fiyatlı kalem ADSIZ olamaz (boş satır düzenleyicide
 * her zaman bir tane duruyor, o kaydedilmemeli). Bölüm ayırıcıda başlık YA DA
 * açıklamadan biri yeterlidir: yalnız açıklama yazıp başlıksız bir ara metin
 * koymak geçerli bir kullanımdır.
 */
function isFilled(item: any): boolean {
  const title = text(item?.description)
  if (isSectionLine(item?.kind)) return Boolean(title || text(item?.note))
  return Boolean(title)
}

export function buildQuoteRecord(items: any[], globalDiscount: QuoteGlobalDiscountInput | null) {
  const valid = (Array.isArray(items) ? items : []).filter(isFilled)
  const totals = calcQuoteTotals(valid, globalDiscount)

  const normalized = valid.map((item, index) => {
    const c = totals.lines[index]
    const note = text(item.note)
    // Bölüm ayırıcı: başlık + açıklama dışındaki her kolon sıfır/boş yazılır.
    // Fiyat alanları NOT NULL olduğu için satır silinemez, sıfırlanır — kalemi
    // bölüme çeviren kullanıcının eski fiyatı kayıtta kalmasın.
    if (isSectionLine(item.kind)) {
      return {
        kind: "SECTION",
        productId: null,
        description: text(item.description),
        note: note || null,
        quantity: 0,
        unitPrice: 0,
        discountRate: null,
        discountAmount: 0,
        vatRate: 0,
        vatAmount: 0,
        totalAmount: 0,
      }
    }
    return {
      kind: "ITEM",
      productId: item.productId || null,
      description: text(item.description),
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
    /** Fiyatlı kalem sayısı — yalnız bölüm başlığından oluşan teklif kaydedilmez. */
    itemCount: normalized.filter((item) => item.kind === "ITEM").length,
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
