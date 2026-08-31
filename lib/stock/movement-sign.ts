/**
 * Stok hareketinin YÖNÜ — tek kaynak.
 *
 * Bugün her hareket `adjustWarehouseStock` üzerinden İŞARETLİ yazılır (giriş +,
 * çıkış −), dolayısıyla işaretin kendisi yeter. Tipe yalnız tek kapı ÖNCESİ
 * yazılmış satırlar için bakılır: onlarda çıkışlar pozitif miktarla duruyor.
 *
 * Kural iki ekranda birden geçerli (ürün kartı hareket listesi ve stok hareket
 * raporu); kopyalansaydı aynı hareket bir ekranda "Giriş", diğerinde "Çıkış"
 * görünebilirdi.
 */

/** Tek kapı öncesi POZİTİF miktarla yazılmış çıkış tipleri. */
export const OUTBOUND_MOVEMENT_TYPES = ["OUT", "SALE", "PURCHASE_CANCEL", "RETURN_CANCEL"]

/** Fiyat yedeği (alış/satış) seçilirken "bu bir giriş mi" sorusunun tip tarafı. */
export const INBOUND_MOVEMENT_TYPES = ["IN", "PURCHASE", "SALE_CANCEL", "RETURN"]

type MovementLike = { type: string; quantity: unknown }

/** İşaretli miktar: + giriş, − çıkış. */
export function signedMovementQuantity(movement: MovementLike): number {
  const quantity = Number(movement.quantity)
  return quantity > 0 && OUTBOUND_MOVEMENT_TYPES.includes(movement.type) ? -quantity : quantity
}

/** Hareket stoğa giriyor mu — fiyatı yoksa alış fiyatına düşmek için. */
export function isInboundMovement(movement: MovementLike): boolean {
  return INBOUND_MOVEMENT_TYPES.includes(movement.type) || Number(movement.quantity) > 0
}

/** Etiket: tipi bilinen özel hareketler kendi adıyla, kalanlar yönüyle anılır. */
export function movementTypeLabel(movement: MovementLike): string {
  if (movement.type === "TRANSFER") return "Transfer"
  if (movement.type === "ADJUSTMENT") return "Düzeltme"
  return signedMovementQuantity(movement) < 0 ? "Çıkış" : "Giriş"
}
