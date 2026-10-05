/**
 * Çek/senet DURUM TARİHİ (`statusChangedAt`) — ciro, tahsil, iade ya da protesto günü.
 * Saf modül; uçlar (`app/api/cek-senet`) ve testi kullanır.
 *
 * Neden ayrı alan: ciro fişi bugüne kadar evrakın `updatedAt`ini kullanıyordu — evraka
 * sonradan not yazmak fiş tarihini kaydırıp onaylı fişi "belge değişti"ye düşürüyordu.
 * Geçmiş tarihli portföy (lib/raporlar/bilanco-kiymet.ts) de ciroyu bugünkü durumla sayıyordu.
 *
 * Kural:
 *   - PORTFÖYDE → null (durumun tarihi yok)
 *   - durum DEĞİŞTİ → istekteki gün, yoksa şimdi
 *   - durum AYNI → istek farklı bir GÜN verdiyse o (düzeltme), yoksa eskisi — formu açıp
 *     kaydetmek (aynı gün yeniden gönderilir) tarihi oynatmaz
 */

export const PORTFOY = "PORTFÖYDE"

/** Gün "YYYY-MM-DD" (İstanbul takvimi — ekrandaki tarih girişiyle aynı eksen). */
const istanbulGunu = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)

/** İstekteki durum tarihi: boş → null; "YYYY-MM-DD" ya da ISO → Date; bozuk → hata. */
export function durumTarihiGirdisi(v: unknown): Date | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw new Error("Durum tarihi geçersiz.")
  return d
}

export function durumTarihi(p: {
  eskiDurum: string | null
  yeniDurum: string
  eskiTarih: Date | null
  istekTarihi: Date | null
  simdi: Date
}): Date | null {
  if (p.yeniDurum === PORTFOY) return null
  if (p.eskiDurum !== p.yeniDurum) return p.istekTarihi ?? p.simdi
  if (!p.istekTarihi) return p.eskiTarih ?? p.simdi
  if (p.eskiTarih && istanbulGunu(p.eskiTarih) === istanbulGunu(p.istekTarihi)) return p.eskiTarih
  return p.istekTarihi
}

/** Tahsil hareketinin tarihi değişmeli mi (durum tarihi düzeltildiyse kasa hareketi de kayar). */
export function ayniGun(a: Date, b: Date): boolean {
  return istanbulGunu(a) === istanbulGunu(b)
}
