import { randomInt } from "node:crypto"

/**
 * Sistem yöneticisinin kullanıcıya ilettiği GEÇİCİ şifre.
 *
 * `Math.random().toString(36)` ile üretiliyordu: V8'in xorshift128+ üreteci
 * kriptografik değildir, çıktı gözlemlenirse sonraki değerler kestirilebilir ve
 * `toString(36).slice(-8)` bazen 7 karakter döner (baştaki sıfır düşer). Şifre
 * bir kimlik doğrulama sırrıdır, oyun zarı değil — `crypto.randomInt` ile
 * düzgün dağılımlı üretilir.
 *
 * Alfabe telefonla/mesajla okunabilir olsun diye karışan karakterleri dışlar
 * (0/O, 1/l/I). 12 karakter × 55 sembol ≈ 69 bit; geçici olduğu ve ilk girişte
 * değiştirildiği için yeterli.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"

export const TEMP_PASSWORD_LENGTH = 12

export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  let out = ""
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}
