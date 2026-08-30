/**
 * GELEN FATURA — GÖNDERİLME TARİHİ.
 *
 * Mysoft inbox kaydında zarfın GİB'e düştüğü an ayrı bir alanda gelir ve alanın
 * ADI sürümden sürüme değişiyor. Bu yüzden olası anahtarları sırayla deneyip ilk
 * dolu olanı kullanıyoruz.
 *
 * Tek kaynak olması ÖNEMLİ: aynı liste hem `incoming_invoices."sentDate"` kolonuna
 * yazılıyor (sync) hem de migrasyondaki geri doldurmada kullanıldı
 * (supabase/migrations/20260830000001_incoming_invoice_sent_date.sql). Sıra ya da
 * içerik değişirse iki taraf birbirinden kayar; anahtar eklerken migrasyonu da
 * güncelleyin.
 */
export const SENT_DATE_KEYS = [
  "envelopeDate",
  "sendDate",
  "createDate",
  "createdDate",
  "lastTrackingDate",
  "documentCreateDate",
  "createDateUtc",
] as const

/** Ham kayıttaki gönderilme tarihini METİN olarak döndürür (yoksa null). */
export function extractSentDateString(raw: any): string | null {
  if (!raw || typeof raw !== "object") return null
  for (const key of SENT_DATE_KEYS) {
    const value = raw[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

/** Metin kendi saat dilimini taşıyor mu ("...Z" ya da "...+03:00")? */
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/

/**
 * SAAT DİLİMİ OLMAYAN değer TÜRKİYE YERELİ kabul edilir (+03:00).
 *
 * Mysoft aynı kayıtta `docDate`i offset'li ("2026-08-28T00:00:00+03:00") ama
 * `createDate`i offset'siz ("2026-08-28 14:52:03") gönderiyor. Offset'siz metni
 * olduğu gibi UTC saymak, sunucu UTC'de çalıştığı için değeri 3 saat İLERİ kaydırır:
 * ekranda 14:52'de gönderilen fatura 17:52 görünür, gece yarısına yakın gönderimler
 * ERTESİ GÜNE taşar (23:34 → 02:34) ve gönderilme tarihine göre filtre gün sınırında
 * yanlış sonuç verir.
 *
 * Değerin yerel olduğu ölçüldü: 1.421 kaydın saat dağılımı %81 oranıyla 08:00–19:00
 * arasında toplanıyor, 04:00–07:00 neredeyse boş — Türkiye mesai saatleri. UTC olsaydı
 * dağılım 3 saat kaymış görünürdü.
 *
 * Sabit +03:00 kullanılıyor, adlandırılmış dilim değil: Türkiye 2016'dan beri kalıcı
 * UTC+3, yaz saati uygulaması yok. Migrasyondaki geri doldurma da aynı offset'i
 * kullanır (AT TIME ZONE INTERVAL '+03:00').
 */
export function normalizeSentDateText(text: string): string {
  if (HAS_TZ.test(text)) return text
  const isoish = text.replace(" ", "T")
  return /T\d{2}:\d{2}/.test(isoish) ? `${isoish}+03:00` : `${isoish}T00:00:00+03:00`
}

/**
 * Ham kayıttaki gönderilme tarihini Date'e çevirir. Çözülemeyen metinde null döner
 * — geçersiz bir Date yazmak kolonu sessizce bozar (Prisma "Invalid Date" ile patlar
 * ya da NULL'dan ayırt edilemeyen bir değer üretir).
 */
export function extractSentDate(raw: any): Date | null {
  const text = extractSentDateString(raw)
  if (!text) return null
  const parsed = new Date(normalizeSentDateText(text))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
