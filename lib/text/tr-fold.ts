/**
 * Türkçe duyarsız arama anahtarı — TEK KAYNAK.
 *
 * Arama ve eşleştirme yaparken büyük/küçük harf VE Türkçe aksan farkı yok
 * sayılır: `ı/i/İ/I → i`, `ş → s`, `ğ → g`, `ü → u`, `ö → o`, `ç → c`,
 * `â/î/û → a/i/u`. Kullanıcı "isik" yazınca "IŞIK" kaydını bulur.
 *
 * Neden `toLowerCase()` yetmez: `lower('I')` = `'i'` ama Türkçe'de `'ı'`dır,
 * `"İ".toLowerCase()` ise iki kod birimi ("i" + U+0307 birleşik nokta) üretir
 * ve hiçbir "i" ile eşleşmez. Bu yüzden harf tablosu ÖNCE uygulanır — I ve İ
 * `toLowerCase()`e hiç girmez.
 *
 * SQL karşılığı `lib/db/tr-search.ts` içindedir ve aynı iki tabloyu
 * (`TR_FOLD_FROM`/`TR_FOLD_TO`) `translate()`e verir; iki taraf birebir aynı
 * anahtarı üretmek zorundadır, o yüzden tablolar buradan dışa açılır.
 *
 * YALNIZ arama/eşleştirme içindir: görüntülenen metne dokunulmaz.
 */

/** Katlanan harfler. `TR_FOLD_TO` ile aynı uzunlukta olmalı (translate kuralı). */
export const TR_FOLD_FROM = "IİıŞşĞğÜüÖöÇçÂâÎîÛû"
/** Karşılıkları — sırası `TR_FOLD_FROM` ile birebir. */
export const TR_FOLD_TO = "iiissgguuooccaaiiuu"

const FOLD_MAP: Map<string, string> = (() => {
  if (TR_FOLD_FROM.length !== TR_FOLD_TO.length) {
    throw new Error("tr-fold: harf tablosu uzunlukları eşit değil")
  }
  const map = new Map<string, string>()
  for (let i = 0; i < TR_FOLD_FROM.length; i += 1) {
    map.set(TR_FOLD_FROM[i], TR_FOLD_TO[i])
  }
  return map
})()

/**
 * Aramada kullanılacak anahtarı üretir. Boş/null → "".
 * Sayı da kabul eder: kod/barkod alanları bazı ekranlarda sayı olarak geliyor.
 */
export function trFold(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const raw = typeof value === "string" ? value : String(value)
  let out = ""
  for (const ch of raw) out += FOLD_MAP.get(ch) ?? ch
  return out.toLowerCase().trim()
}

/** `trFold` anahtarında alt dize araması. Terim boşsa her şey eşleşir. */
export function trIncludes(
  haystack: string | number | null | undefined,
  term: string | number | null | undefined,
): boolean {
  const needle = trFold(term)
  if (!needle) return true
  return trFold(haystack).includes(needle)
}

/**
 * Bellek içi listeleri süzmek için: terim BİR kez katlanır, dönen fonksiyon
 * her satırda yalnız alanları katlar.
 *
 * ```ts
 * const eslesir = trMatcher(arama)
 * rows.filter((r) => eslesir(r.name, r.code, r.barcode))
 * ```
 */
export function trMatcher(
  term: string | number | null | undefined,
): (...fields: Array<string | number | null | undefined>) => boolean {
  const needle = trFold(term)
  if (!needle) return () => true
  return (...fields) => fields.some((field) => trFold(field).includes(needle))
}
