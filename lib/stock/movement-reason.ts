/**
 * Elle girilen stok ÇIKIŞININ nedeni — saf modül (pencere, uç ve raporlar okur).
 *
 * Belgeye bağlı hareketin nedeni belgesinden bellidir (satış faturası, fiş,
 * adisyon ikramı…). Elle çıkışta ise kayıttan "satış mı fire mi" okunamıyordu;
 * stok raporunun satış adedi faturasız satışı hiç göremiyordu. Neden yalnız elle
 * ÇIKIŞTA sorulur ve `StockMovement.reason`a yazılır. Boş (null) = eski kayıt ya
 * da nedeni sorulmamış hareket; raporda "diğer" sayılır, satış SAYILMAZ.
 */

export const STOCK_OUT_REASONS = ["SALE", "WASTE", "SAMPLE", "INTERNAL_USE", "OTHER"] as const
export type StockOutReason = (typeof STOCK_OUT_REASONS)[number]

export const STOCK_OUT_REASON_LABEL: Record<StockOutReason, string> = {
  SALE: "Satış (faturasız)",
  WASTE: "Fire / zayi",
  SAMPLE: "Numune / promosyon",
  INTERNAL_USE: "İç kullanım",
  OTHER: "Diğer",
}

/** Hareket listelerinde tipin yanına yazılan kısa ad. */
export const STOCK_OUT_REASON_SHORT: Record<StockOutReason, string> = {
  SALE: "Satış",
  WASTE: "Fire",
  SAMPLE: "Numune",
  INTERNAL_USE: "İç kullanım",
  OTHER: "Diğer",
}

export function isStockOutReason(value: unknown): value is StockOutReason {
  return typeof value === "string" && (STOCK_OUT_REASONS as readonly string[]).includes(value)
}
