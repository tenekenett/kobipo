/**
 * T.C. Kimlik No doğrulaması (resmi algoritma).
 * - 11 hane, ilk hane 0 olamaz
 * - 10. hane: ((1,3,5,7,9. hanelerin toplamı * 7) - (2,4,6,8. hanelerin toplamı)) mod 10
 * - 11. hane: ilk 10 hanenin toplamı mod 10
 */
export function isValidTcKimlik(value: string): boolean {
  const v = String(value || "").trim()
  if (!/^\d{11}$/.test(v)) return false
  const d = v.split("").map(Number)
  if (d[0] === 0) return false

  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8]
  const evenSum = d[1] + d[3] + d[5] + d[7]
  const digit10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10
  if (digit10 !== d[9]) return false

  const sumFirst10 = d.slice(0, 10).reduce((a, b) => a + b, 0)
  if (sumFirst10 % 10 !== d[10]) return false

  return true
}

/**
 * Belgeye "harici bağlantı" olarak girilen adres — yalnız mutlak http(s) URL.
 *
 * Alan doğrulanmadan yazılıyordu; indirme ucu `NextResponse.redirect(fileUrl)` ile
 * yönlendirdiği için "edasdadas" gibi bir değer belgeyi açan HERKESE 500 döndürüyordu
 * (2026-09-18 taramasında canlıda bulundu). `javascript:`/`data:` gibi şemalar da
 * yönlendirme hedefi olamaz. Boş/whitespace → null ("bağlantı yok"); geçersiz → false
 * (çağıran 400 döner, sessizce null'a düşürmez).
 */
export function normalizeExternalFileUrl(input: unknown): string | null | false {
  const raw = typeof input === "string" ? input.trim() : ""
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== "http:" && u.protocol !== "https:") return false
    return u.toString()
  } catch {
    return false
  }
}
