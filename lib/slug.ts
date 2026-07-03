/**
 * Ortak slug yardımcıları — SEF (arama motoru dostu / okunabilir) URL'ler için.
 * `slugify` blog'dan buraya taşındı; blog modülü artık buradan re-export eder.
 */

/** Türkçe karakterleri sadeleştirip URL-güvenli slug üretir. */
export function slugify(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/**
 * Bir URL segmentinin cuid (ham veritabanı id'si) gibi görünüp görünmediğini söyler.
 * Prisma `@default(cuid())` id'leri 'c' ile başlar ve ~25 küçük harf/rakam içerir
 * (ör. "cmoldruv20002ewu7rfvihqzy"). Eski cuid URL'lerini yeni slug URL'ine
 * yönlendirmek (geri uyum) için detay sayfalarında kullanılır.
 */
export function looksLikeCuid(segment: string): boolean {
  return /^c[a-z0-9]{20,}$/.test(segment)
}

/**
 * `base` slug'ını, verilen `exists` kontrolüne göre benzersiz hale getirir.
 * Çakışma varsa `-2`, `-3`, ... eki dener; makul denemeden sonra kısa rastgele
 * olmayan bir sayaç kullanır. `exists(candidate)` true dönerse o aday kullanılmaz.
 *
 * Not: Yarış koşulları için çağıran taraf DB'de `@@unique([scope, slug])` kısıtına
 * güvenmeli (bu yalnızca insan-okunur, çoğunlukla benzersiz bir aday üretir).
 *
 * @param base   slugify edilmiş temel metin (boşsa "kayit" kullanılır)
 * @param exists adayın halihazırda kullanımda olup olmadığını döndüren async fn
 */
export async function makeUniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>
): Promise<string> {
  const root = base || "kayit"
  if (!(await exists(root))) return root
  for (let i = 2; i <= 50; i++) {
    const candidate = `${root}-${i}`
    if (!(await exists(candidate))) return candidate
  }
  // Aşırı çakışma: zaman damgası tabanlı sonek (deterministik değil ama nadir yol).
  return `${root}-${Date.now().toString(36)}`
}
