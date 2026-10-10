/**
 * TELEFON STANDARDI — Türkiye numarası, 0 ile başlayan 11 hane.
 *
 *   saklanan : "05321234567"     (yalnız rakam — `User.phone`)
 *   görünen  : "0532 123 45 67"  (giriş alanı da bu maskeyle yazar)
 *
 * Kayıt ekranı (2026-10-10'a kadar) telefonu serbest metin olarak alıyordu; aynı
 * tabloda "05321234567", "5321234567" ve "+90 532 123 4567" yan yana duruyordu.
 * Davet ekranının kuralı (11 hane, 0 ile başlar) buraya taşındı; kayıt, davet ve
 * profil aynı fonksiyondan geçer, uçlar da aynı kuralla doğrular.
 *
 * Saf modül: istemcide de çalışır.
 */

const MAX_DIGITS = 11

/**
 * Girilen metni standart rakam dizisine çevirir (yarım numarada da çalışır — maske
 * her tuşta bunu çağırır):
 *   "+90 532 …" / "0090 532 …" / "90532…" (12 hane) → ülke kodu düşer
 *   "532…"                                         → başına 0 eklenir
 * Tek başına "9" / "90" ülke kodu yazılıyor olabilir; bir sonraki rakama kadar
 * olduğu gibi bırakılır.
 */
export function trPhoneDigits(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "")
  if (d.startsWith("0090") && d.length > 4) d = d.slice(4)
  else if (d.startsWith("90") && d.length > 2) d = d.slice(2)
  if (d === "9" || d === "90") return d
  if (d && !d.startsWith("0")) d = `0${d}`
  return d.slice(0, MAX_DIGITS)
}

/** Maske: "0532 123 45 67". Yarım numarayı da gruplar (giriş alanında kullanılır). */
export function formatTrPhone(raw: string | null | undefined): string {
  const d = trPhoneDigits(raw)
  const parts: string[] = []
  if (d.length > 0) parts.push(d.slice(0, 4))
  if (d.length > 4) parts.push(d.slice(4, 7))
  if (d.length > 7) parts.push(d.slice(7, 9))
  if (d.length > 9) parts.push(d.slice(9, 11))
  return parts.join(" ")
}

/**
 * Geçerli numara: 0 + 10 hane, alan kodu 2–5 (sabit hat / GSM) ya da 8 (0850, 0800).
 * Başka bir ilk hane Türkiye'de numara değildir ("0000…", "0123…" gibi girişler).
 */
export function isValidTrPhone(raw: string | null | undefined): boolean {
  return /^0[2-58]\d{9}$/.test(trPhoneDigits(raw))
}

/** Geçerliyse saklanacak rakam dizisi, değilse null. Uçlar bunu kullanır. */
export function normalizeTrPhone(raw: string | null | undefined): string | null {
  const d = trPhoneDigits(raw)
  return /^0[2-58]\d{9}$/.test(d) ? d : null
}

/** Ekranda göstermek için: standarda uyan numara maskeli, eski serbest kayıt olduğu gibi. */
export function displayTrPhone(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim()
  return isValidTrPhone(value) ? formatTrPhone(value) : value
}

/** Kullanıcıya gösterilen tek hata metni (istemci ve uçlar aynısını söyler). */
export const TR_PHONE_ERROR = "Geçerli bir telefon numarası girin (0 ile başlayan 11 hane, örn. 0532 123 45 67)."
