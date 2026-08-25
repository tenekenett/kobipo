// Sayı/para biçimlendirmenin tek yeri.
//
// Bu dosyadan önce aynı üç yardımcı dört ayrı dosyada yeniden yazılmıştı
// (rapor UI, kahveci satış ekranı, reçete ekranı, fiş HTML'i) ve aralarında
// sessiz farklar vardı — biri `maximumFractionDigits` veriyor, diğeri
// vermiyordu. Aynı miktar iki ekranda iki türlü görünüyordu.
//
// Sunucuda da kullanılabilir (saf, tarayıcı API'si gerektirmez — Intl her iki
// çalışma zamanında da var).

/** ₺1.234,50 — para tutarları. */
export const money = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)

/** ₺1.235 — kuruşun anlamsız olduğu özet kutuları (ciro, ortalama fiş). */
export const money0 = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)

/**
 * Stok miktarı. Kolonlar `Decimal(14,4)` — 4 ondalık şart: 20 gr kahve KG
 * cinsinden 0,02; 5 ml vanilya LT cinsinden 0,005 eder. 2 ondalıkla
 * biçimlendirmek bunları ekranda sıfırlardı.
 */
export const qty = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(n) || 0)

/** %80,0 — null/NaN girdide tire (0 DEĞİL: "hesaplanamadı" ile "sıfır" farklı). */
export const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `%${n.toFixed(1)}`

/**
 * "12,5" ve "12.5" ikisini de kabul eden sayı ayrıştırıcı; geçersizse NaN.
 * Türkçe klavyede ondalık ayırıcı virgül — form girdilerinde şart.
 */
export const parseNum = (raw: string): number =>
  parseFloat(String(raw ?? "").replace(",", "."))

/**
 * Tutarı ürünün KENDİ para birimiyle biçimler (₺/$/€). Geçersiz/eksik kodda TRY'ye düşer.
 *
 * `money`den farkı: para birimi çağıranın verdiği alandan gelir. Ürün kartında
 * `currency` alanı var ve fiyat O cinsten; sabit TRY ile basmak 100 $'lık ürünü
 * ekranda "100 ₺" gösterir — kullanıcı da ürünü o fiyata satar.
 *
 * `signed` kâr/fark gibi işaretin anlamlı olduğu yerlerde `+`/`−` ekler.
 */
export function formatMoney(amount: number, currency?: string | null, signed = false): string {
  const cur = (currency || "TRY").toUpperCase()
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency: ["TRY", "USD", "EUR"].includes(cur) ? cur : "TRY",
    currencyDisplay: "narrowSymbol",
  }
  if (signed) opts.signDisplay = "exceptZero"
  return new Intl.NumberFormat("tr-TR", opts).format(Number.isFinite(amount) ? amount : 0)
}
