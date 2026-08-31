/**
 * Elle girilen bir stok hareketinin TARİHİ.
 *
 * Neden gerekli: mal dün geldi, kayıt bugün giriliyor. Hareketin tarihi
 * `StockMovement.createdAt`tir (ayrı bir "belge tarihi" sütunu yok) ve stok
 * raporları dönemi oradan süzer — kayıt anını yazmak dünkü girişi bu aya taşır,
 * dönem kapanışını da sessizce bozardı.
 *
 * Neden gün ortası: ekran GÜN seçtirir ("2026-08-29"), saat sormaz. Tarih-only
 * metni doğrudan `new Date(...)`e verilirse UTC gece yarısı olur ve sunucu ile
 * kullanıcı farklı saat diliminde olduğunda gün KAYAR. Yerel 12:00 hiçbir gerçek
 * saat diliminde günü kaydırmaz.
 *
 * Neden BUGÜN "şimdi": aynı gün içinde girilen hareketler defterde giriş sırasına
 * dizilmeli. Bugün için 12:00 sabiti yazılsaydı, sabah 14:00'te yazılmış bir
 * hareketin ARKASINA düşerdi.
 *
 * İleri tarih REDDEDİLİR: olmamış bir mal girişi bakiyeyi bugünden şişirir.
 */

export type MovementDateResult =
  | { ok: true; date: Date | null }
  | { ok: false; error: string }

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Hareketin en erken kabul edilen tarihi — daha eskisi yazım hatasıdır. */
const MIN_YEAR = 2000

/**
 * Gövdeden gelen tarihi Date'e çevirir.
 *
 * Boş/verilmemiş → `date: null`: çağıran hiçbir şey yazmaz ve `createdAt`
 * veritabanı varsayılanına (now) düşer. "Bugün" ile "belirtilmemiş" arasındaki
 * fark burada korunur; ikisini de now'a çevirmek zararsız olurdu ama çağıranın
 * "kullanıcı tarih seçti mi" bilgisini kaybettirirdi.
 */
/**
 * `anchor`: gün içindeki SAAT nasıl seçilsin?
 *  • "now"      — yeni bir fiş yazılıyor. Bugün seçildiyse saat "şimdi" olur ki
 *                 hareket defterde bugünkü diğerlerinin ARDINA dizilsin.
 *  • "dayStart" — AÇILIŞ düzeltiliyor. Açılış, günün ilk kaydıdır: "şimdi"
 *                 damgalanırsa aynı gün girilmiş satışların ARKASINA düşer ve
 *                 defter "önce sattık, sonra açtık" gibi okunur (canlıda böyle
 *                 görüldü: açılış satırı listenin en altına indi).
 */
export function parseMovementDate(
  raw: unknown,
  now: Date = new Date(),
  opts: { anchor?: "now" | "dayStart" } = {},
): MovementDateResult {
  const anchor = opts.anchor ?? "now"
  if (raw === undefined || raw === null || raw === "") return { ok: true, date: null }
  if (typeof raw !== "string") return { ok: false, error: "Geçersiz tarih" }

  const text = raw.trim()
  if (!text) return { ok: true, date: null }

  const parts = DATE_ONLY.exec(text)
  if (parts) {
    const [, y, m, d] = parts
    const year = Number(y)
    const month = Number(m)
    const day = Number(d)
    const hour = anchor === "dayStart" ? 0 : 12
    const candidate = new Date(year, month - 1, day, hour, 0, 0, 0)
    // Takvimde olmayan gün (31 Şubat) JS'te sessizce kayar; geri okuyup doğruluyoruz.
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month - 1 ||
      candidate.getDate() !== day
    ) {
      return { ok: false, error: "Geçersiz tarih" }
    }
    if (year < MIN_YEAR) return { ok: false, error: `Tarih ${MIN_YEAR} yılından eski olamaz` }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
    if (candidate.getTime() > today.getTime()) {
      return { ok: false, error: "İleri tarihli stok hareketi yazılamaz" }
    }
    if (candidate.getTime() === today.getTime() && anchor === "now") {
      return { ok: true, date: new Date(now) }
    }
    return { ok: true, date: candidate }
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: "Geçersiz tarih" }
  if (parsed.getFullYear() < MIN_YEAR) {
    return { ok: false, error: `Tarih ${MIN_YEAR} yılından eski olamaz` }
  }
  if (parsed.getTime() > now.getTime()) {
    return { ok: false, error: "İleri tarihli stok hareketi yazılamaz" }
  }
  return { ok: true, date: parsed }
}

/** `<input type="date">` için yerel gün metni (toISOString UTC'ye kaydırırdı). */
export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return ""
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
