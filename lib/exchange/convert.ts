/**
 * Para birimi çevrimi — saf çekirdek.
 *
 * Kur getirme (React kancası) `use-rates.ts`de; burada yalnız aritmetik var ki
 * test edilebilsin. Ekranda 100 $'ı 100 ₺ yapan hata bu dosyada yakalanır.
 */

export type Rates = { USD: number; EUR: number } | null

/** X → TRY oranı; bilinmeyen para birimi veya kur yoksa 0. */
export function rateOf(rates: Rates, cur: string): number {
  const code = (cur || "TRY").toUpperCase()
  if (code === "TRY") return 1
  if (code === "USD") return Number(rates?.USD) || 0
  if (code === "EUR") return Number(rates?.EUR) || 0
  return 0
}

/**
 * `value` tutarını `from` biriminden `to` birimine çevirir.
 *
 * Kur bilinmiyorsa **null** döner — 0 DEĞİL: "bilmiyorum" ile "bedava" farklı
 * şeyler ve 0 döndürmek çağıranı sessizce yanlış fiyata razı ederdi. Çağıran
 * null'ı kendi bağlamına göre karşılar (teklifte çevirmeden ekle + uyar, tezgâhta
 * fiyatı boş bırak).
 */
export function convertAmount(
  value: number,
  from: string,
  to: string,
  rates: Rates,
): number | null {
  const f = (from || "TRY").toUpperCase()
  const t = (to || "TRY").toUpperCase()
  if (f === t) return value
  const rf = rateOf(rates, f)
  const rt = rateOf(rates, t)
  if (!rf || !rt) return null
  return value * (rf / rt)
}
