// Barkod tezgâhının miktar çarpanı — saf kural (ürün seçici kullanır, test edilir).

/**
 * Tezgâh miktar çarpanı: "3*8690…" ya da "2,5*hortum" → miktar 3 / 2,5, aranan
 * "8690…" / "hortum". Ayraç YALNIZ yıldızdır: "x" ürün adlarında boyut ayracı
 * ("18x20 rekor") ve çarpan sanılırdı. Çarpan yoksa ya da 0 ise miktar null.
 */
export function parseScanMultiplier(raw: string): { quantity: number | null; term: string } {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/.exec(raw)
  if (!m) return { quantity: null, term: raw }
  const quantity = Number(m[1].replace(",", "."))
  if (!Number.isFinite(quantity) || quantity <= 0) return { quantity: null, term: m[2] }
  return { quantity, term: m[2] }
}
