// Faturanın CARİ üzerindeki yönünün TEK tanımı.
//
// Dört belge ailesi var ve iade, ait olduğu ailenin TERS İŞARETLİSİDİR:
//
//   satış         → müşteri bize borçlanır        (+alacak)
//   satış iadesi  → o borç azalır                 (−alacak)
//   alış          → biz tedarikçiye borçlanırız   (+borç)
//   alış iadesi   → o borç azalır                 (−borç)
//
// Bu kural altı ayrı yerde uygulanıyor (cari listesi SQL'i, müşteri/tedarikçi
// detay uçları, ekstre, yaşlandırma). Ayrı ayrı yazılsaydı biri iadeyi unuttuğu
// an liste "borçlu" derken kart "kapalı" derdi — nitekim düzeltilene kadar
// HİÇBİRİ iadeyi saymıyordu ve müşteri geri verdiği malın borcunu taşıyordu.
//
// `returnKind` NULL = satış iadesi: sütun eklenmeden önce kesilmiş iadeler o gün
// tek yönlüydü (bkz. 20260825000001_invoice_return_kind.sql).

export type DirectionalInvoice = {
  type: string
  returnKind?: string | null
}

/** Malı TEDARİKÇİYE geri gönderdiğimiz iade mi? */
export function isPurchaseReturn(inv: DirectionalInvoice): boolean {
  return (
    String(inv.type || "").toUpperCase() === "RETURN" &&
    String(inv.returnKind || "SALES").toUpperCase() === "PURCHASE"
  )
}

/** Müşterinin bize geri verdiği mal için kestiğimiz iade mi? */
export function isSalesReturn(inv: DirectionalInvoice): boolean {
  return String(inv.type || "").toUpperCase() === "RETURN" && !isPurchaseReturn(inv)
}

/**
 * ALACAK ailesindeki işaret (müşteri tarafı): satış +1, satış iadesi −1,
 * bu aileye girmeyen belge 0.
 */
export function receivableSign(inv: DirectionalInvoice): 1 | 0 | -1 {
  const t = String(inv.type || "").toUpperCase()
  if (t === "SALES") return 1
  if (isSalesReturn(inv)) return -1
  return 0
}

/**
 * BORÇ ailesindeki işaret (tedarikçi tarafı): alış +1, alış iadesi −1,
 * bu aileye girmeyen belge 0.
 */
export function payableSign(inv: DirectionalInvoice): 1 | 0 | -1 {
  const t = String(inv.type || "").toUpperCase()
  if (t === "PURCHASE") return 1
  if (isPurchaseReturn(inv)) return -1
  return 0
}

// --- Prisma `where` parçaları -------------------------------------------------
//
// DİKKAT: `{ returnKind: { not: "PURCHASE" } }` TEK BAŞINA yetmez — SQL'de
// `<> 'PURCHASE'` NULL satırları ELEMEZ, döndürmez de; NULL karşılaştırması
// NULL'dır. Yön alanı boş olan eski iadeler bu yüzden açıkça OR'lanır.

/**
 * Satış iadeleri (yönü boş olanlar dâhil).
 *
 * Fonksiyon çünkü `where`lara YAYILIYOR: paylaşılan tek nesne, Prisma'nın iç
 * içe filtrelerinde yeniden kullanıldığında sürprizlere açık; her çağrı taze
 * nesne döndürür.
 */
export const SALES_RETURN_WHERE = () => ({
  type: "RETURN",
  OR: [{ returnKind: null }, { returnKind: { not: "PURCHASE" } }],
})

/** Alış iadeleri. */
export const PURCHASE_RETURN_WHERE = () => ({
  type: "RETURN",
  returnKind: "PURCHASE",
})
