import { trFold } from "@/lib/text/tr-fold"

/**
 * Ortak slug yardımcıları — SEF (arama motoru dostu / okunabilir) URL'ler için.
 * `slugify` blog'dan buraya taşındı; blog modülü artık buradan re-export eder.
 */

/**
 * Türkçe karakterleri sadeleştirip URL-güvenli slug üretir.
 *
 * KATLAMA KÜÇÜLTMEDEN ÖNCE GELİR. Önceki sürüm `toLowerCase()`i ilk sıraya koyup
 * `İ → i` değişimini sonraya bırakıyordu ve o değişim HİÇ eşleşmiyordu:
 * `"İ".toLowerCase()` Türkçe'de "i" değil, "i" + U+0307 (birleşen nokta) üretir.
 * Nokta sonra `[^a-z0-9]` süzgecine takılıp TİREYE dönüşüyordu:
 *
 *     "Yıllık İzin Talep Formu" → yillik-i-zin-talep-formu
 *     "İstifa Dilekçesi"        → i-stifa-dilekcesi
 *
 * Aynı işi yapan SQL trigger'ı (`set_entity_slug`, migrasyon 20260703000001) doğru
 * sırayla çalışıyor: `LOWER(TRANSLATE(...))`. Yani iki taraf aynı ad için farklı
 * slug üretiyordu; cari/ürün/personel kayıtları trigger'dan geçtiği için veri
 * bozulmadı, ama blog yazısı, rol kalıbı anahtarı ve `issue-sales-invoice`'ın
 * müşteri açma yolu TS tarafından besleniyor.
 *
 * Katlama artık tek kaynaktan gelir: `trFold` (bkz. CLAUDE.md → Türkçe duyarsız
 * arama). Yan kazanç, düzeltmenin parçası değil: â/î/û da sadeleşir.
 */
export function slugify(input: string): string {
  return trFold(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/**
 * Düzeltmeden ÖNCEKİ (hatalı) slug — yalnız GERİYE UYUM eşleşmesi için.
 *
 * Blog kategori sayfalarının slug'ı saklanmaz, her istekte kategori adından
 * hesaplanır. Bu yüzden `slugify`ı düzeltmek dışarıda paylaşılmış/dizine girmiş
 * `/kategori/i-s-dunyasi` gibi adresleri 404'e düşürürdü. `getCategoryBySlug`
 * önce doğru slug'ı, tutmazsa bunu dener.
 *
 * YENİ ADRES ÜRETMEK İÇİN KULLANILMAZ.
 */
export function legacySlugify(input: string): string {
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
