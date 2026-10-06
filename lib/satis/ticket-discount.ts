// Tezgâhta fiş altı iskonto (Hızlı Satış) — saf hesap.
//
// Kasiyer iskontoyu KDV DAHİL tutar ya da yüzde olarak girer (ekranda gördüğü
// rakam). Fatura ucu ise genel iskontoyu NET (matrah) olarak bekler ve KDV'yi
// aynı oranda düşürür (`globalDiscountAmount`, bkz. lib/invoice/document-totals.ts).
// Çeviri kahveci ekranındakiyle aynı: net iskonto = brüt iskonto × net/brüt.
// Sunucu belgeyi kendi kuralıyla yuvarlar; tahsilat SUNUCUNUN toplamından gelir
// (lib/satis/submit-receipt-sale.ts), buradaki toplam yalnız ekran içindir.

export type TicketDiscount = { type: "AMOUNT" | "PERCENT"; value: string }

export const emptyTicketDiscount = (): TicketDiscount => ({ type: "AMOUNT", value: "" })

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export type DiscountResult = {
  /** KDV dahil iskonto — ekranda ve fişte yazan. */
  gross: number
  /** Matrahtan düşen — fatura ucuna `globalDiscountAmount` olarak gider. */
  net: number
  /** İskontodan sonra ödenecek (KDV dahil). */
  total: number
}

/**
 * @param totals sepetin iskontosuz toplamları (net = matrah, total = KDV dahil)
 * @param value  kasiyerin yazdığı tutar/yüzde, sayıya çevrilmiş (0 = iskonto yok)
 */
export function applyTicketDiscount(
  totals: { net: number; total: number },
  type: TicketDiscount["type"],
  value: number
): DiscountResult {
  const base = round2(totals.total)
  if (!(value > 0) || base <= 0) return { gross: 0, net: 0, total: base }
  const gross =
    type === "PERCENT" ? round2(base * (Math.min(100, value) / 100)) : round2(Math.min(value, base))
  const net = totals.total > 0 ? round2(gross * (totals.net / totals.total)) : 0
  return { gross, net, total: round2(base - gross) }
}

/** Fişte yazan etiket: "İskonto %10" / "İskonto". */
export const ticketDiscountLabel = (type: TicketDiscount["type"], value: number) =>
  type === "PERCENT" ? `İskonto %${String(value).replace(".", ",")}` : "İskonto"
