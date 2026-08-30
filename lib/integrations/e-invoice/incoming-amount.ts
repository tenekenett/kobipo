/**
 * GELEN FATURA TUTARI → ₺ KARŞILIĞI.
 *
 * Tutarlar (`payableAmount`, `taxExclusiveAmount`, `vatAmount`) faturanın KENDİ para
 * biriminde saklanır; Mysoft'un "Tra" ekli alanları da (`taxTotalTra`) TL değil, belge
 * birimindedir — 318,20 USD'lik faturada `taxTotalTra` 53,03 USD gelir. Çeviren tek
 * alan `currencyRate`: 1 birim dövizin kaç TL ettiği (TRY faturalarda 1).
 *
 * Özet kartları tek bir ₺ rakamı gösterdiği için toplamlar buradan geçirilir. Kur ile
 * çarpmadan toplamak 318 USD'yi 318 ₺ sayardı; ölçüldüğünde tek firmada 2,7 milyon ₺
 * eksik toplam demekti.
 *
 * Kuru olmayan DÖVİZ faturası toplama 1 kurundan KATILMAZ — o da aynı hatanın sessiz
 * hâli olurdu. Çağıran taraf `converted:false` dönen satırları sayar ve kullanıcıya
 * "şu kadar fatura toplama dahil edilmedi" der.
 */
export function toTryAmount(
  amount: unknown,
  currencyRate: unknown,
  currencyCode: string | null | undefined,
): { try: number; converted: boolean } {
  const value = amount === null || amount === undefined ? 0 : Number(amount)
  const safeValue = Number.isFinite(value) ? value : 0
  const rate = currencyRate === null || currencyRate === undefined ? NaN : Number(currencyRate)

  if (Number.isFinite(rate) && rate > 0) {
    return { try: safeValue * rate, converted: true }
  }
  // Kur yok: TRY (ya da birimi hiç belirtilmemiş) kayıtta 1 kabul etmek güvenli.
  const isTry = !currencyCode || currencyCode.toUpperCase() === "TRY"
  return { try: isTry ? safeValue : 0, converted: isTry }
}

/** Para birimi TRY dışı mı? (birim boşsa TRY sayılır) */
export function isForeignCurrency(currencyCode: string | null | undefined): boolean {
  return Boolean(currencyCode) && currencyCode!.toUpperCase() !== "TRY"
}

/** Kuruş hassasiyetine yuvarlar — kur çarpımı kayan nokta kuyruğu bırakıyor. */
export function roundKurus(value: number): number {
  return Math.round(value * 100) / 100
}
