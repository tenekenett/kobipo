/**
 * Belge testleri için DETERMİNİSTİK rastgele içerik üreteci.
 *
 * Kayma hataları "karakter karakter" ortaya çıkıyor: alan bir harf daha uzayınca
 * kolon taşıyor. Gözle bulunamayacak bu eşikleri makineye taratmak için testler
 * alanları farklı uzunluklarda üretip her seferinde yerleşim değişmezlerini
 * doğrular. Tohum sabit olduğu için bir hata yakalandığında BİREBİR tekrar
 * üretilebilir (aynı tohum → aynı içerik).
 */

/** mulberry32 — küçük, hızlı, tekrarlanabilir PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = [
  "Kobipo",
  "Reypo",
  "Medya",
  "Ajansı",
  "Limited",
  "Şirketi",
  "Üniversite",
  "Caddesi",
  "Pamukkale",
  "İstanbul",
  "Beşiktaş",
  "montaj",
  "hizmeti",
  "keçe",
  "vinç",
  "hidrolik",
  "pnömatik",
  "İĞÜŞÖÇ",
  "ğüşiöç",
  "12*45",
  "A/B-1",
]

/** Türkçe karakterli, boşluklu metin — verilen uzunluğa yaklaşır. */
export function words(rand: () => number, length: number): string {
  if (length <= 0) return ""
  let out = ""
  while (out.length < length) {
    out += (out ? " " : "") + WORDS[Math.floor(rand() * WORDS.length)]
  }
  return out.slice(0, length)
}

/** Boşluksuz jeton (ürün kodu, IBAN, URL, e-posta) — en zorlu durum. */
export function token(rand: () => number, length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/."
  let out = ""
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(rand() * alphabet.length)]
  return out
}

/**
 * Bir alan için "kötü niyetli" değer üretir: bazen boş, bazen normal, bazen
 * boşluksuz dev jeton, bazen ikisinin karışımı.
 */
export function fuzzField(rand: () => number, maxLength = 220): string {
  const roll = rand()
  const len = Math.floor(rand() * maxLength)
  if (roll < 0.1) return ""
  if (roll < 0.3) return token(rand, Math.max(8, len))
  if (roll < 0.45) return `${words(rand, Math.floor(len / 2))} ${token(rand, Math.floor(len / 2))}`.trim()
  return words(rand, Math.max(3, len))
}

/** Uçtaki sayılar: 0, kuruşlu, milyarlık, çok ondalıklı. */
export function fuzzAmount(rand: () => number): number {
  const roll = rand()
  if (roll < 0.15) return 0
  if (roll < 0.35) return Math.round(rand() * 10000) / 100
  if (roll < 0.6) return Math.round(rand() * 1_000_000_00) / 100
  if (roll < 0.85) return Math.round(rand() * 100_000_000_000) / 100
  return rand() * 1_000_000
}
