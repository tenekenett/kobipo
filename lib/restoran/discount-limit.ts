// İSKONTO TAVANI — işletmenin bir hesapta verilmesine izin verdiği en yüksek indirim.
//
// Neden var: iskonto ekranda tek dokunuşluk bir iştir ve kimin ne kadar
// indirdiğini rapor sonradan söyler. Denetim raporu kaçağı GÖRÜNÜR kılıyordu;
// bu tavan OLUŞMASINI engelliyor — "%80 indirim" bir daha hiç yazılamasın diye.
//
// Tavan YÜZDE olarak tanımlanır ama TUTAR iskontosunu da bağlar: 600 ₺'lik
// hesaba 500 ₺ indirim %83'tür. Ölçü her iki türde de aynı: iskontonun hesaba
// oranı. Aksi halde tavan, "yüzde" düğmesine basmayan kasiyer için hiç yoktu.
//
// Dosya SAF ve izomorfiktir (ticket-constants.ts ile aynı gerekçe): aynı hesap
// hem diyalogda çalışır (kullanıcı "Uygula"ya basmadan önce görsün) hem üçünde
// de sunucuda (uç doğrudan çağrılırsa da dursun).

import { money } from "@/lib/format"
import { grossDiscountOf, type TicketDiscount } from "@/lib/restoran/ticket-constants"

/**
 * Firma başına tek değer (`Company.restaurantMaxDiscountPercent`).
 *
 *   null → tavan YOK (bugüne kadarki davranış; hiç ayar yapmamış firma)
 *   0    → iskonto tamamen kapalı — geçerli ve bilinçli bir tercih, "tanımsız"
 *          ile karıştırılmamalı; bu yüzden `0 || null` gibi kısayollar YASAK.
 */
export type DiscountLimit = number | null

/** Kuruş toleransı: yüzde → tutar çevrimi iki tarafta da yuvarlanıyor. */
const EPSILON = 0.01

/**
 * DB'den ya da gövdeden okunan değeri güvenli tavana çevirir. Tanınmayan değer
 * `null` (sınırsız) sayılır — bozuk bir kayıt yüzünden kasa kilitlenmemeli.
 * Girdi DOĞRULAMASI için bu yetmez, `isValidLimitInput` ayrıca sorulur.
 */
export function normalizeDiscountLimit(value: unknown): DiscountLimit {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, n))
}

/**
 * Kullanıcının girdiği tavan kabul edilebilir mi?
 *
 * `normalizeDiscountLimit` ayrı duruyor çünkü o, bozuk veriyi sessizce
 * "sınırsız"a düşürür; ayar ucunda bu tam tersi bir sonuç verirdi — patron %50
 * yazar, sunucu anlamaz, kayıt sınırsız olur ve kimse fark etmez.
 */
export function isValidLimitInput(value: unknown): boolean {
  if (value === null) return true // "sınır yok"
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 100
}

/** Bu hesapta verilebilecek en yüksek iskonto (KDV dahil); tavan yoksa null. */
export function maxDiscountFor(gross: number, limit: DiscountLimit): number | null {
  if (limit === null) return null
  if (!(gross > 0)) return 0
  return (gross * limit) / 100
}

/**
 * Bir TUTARIN tavanı aşıp aşmadığı. `base` iskontonun ölçüldüğü tabandır ve
 * brüt/net olması fark etmez: iskonto matraha da brüte de AYNI oranda düşer
 * (bkz. ticketTotals → netDiscount), oran ikisinde de aynı çıkar.
 */
export function amountExceedsLimit(
  amount: number,
  base: number,
  limit: DiscountLimit,
): boolean {
  const max = maxDiscountFor(base, limit)
  if (max === null) return false
  // Taban bilinmiyorsa (kalemsiz hesap) oran hesaplanamaz; kapanışta yeniden
  // ölçülür. Burada reddetmek, henüz boş olan hesaba iskonto girilmesini
  // sebepsizce engellerdi.
  if (!(base > 0)) return false
  return amount > max + EPSILON
}

/**
 * Uygulanmak istenen iskonto tavanı aşıyor mu?
 *
 * Yüzde, hesabın toplamına BAKMADAN da ölçülebilir (ve ölçülür): kalemsiz
 * adisyona girilen "%80" de reddedilmeli, sonradan kalem eklenince tavanı
 * aşacağı bugünden bellidir.
 */
export function discountExceedsLimit(
  discount: TicketDiscount,
  gross: number,
  limit: DiscountLimit,
): boolean {
  if (limit === null || !discount) return false
  if (discount.type === "PERCENT") return discount.value > limit + 1e-9
  return amountExceedsLimit(grossDiscountOf(discount, gross), gross, limit)
}

/** Ayar ekranında ve diyalog başlığında görünen tek cümle. */
export function discountLimitLabel(limit: DiscountLimit): string {
  if (limit === null) return "İskonto sınırı yok"
  if (limit === 0) return "İskonto kapalı"
  return `En fazla %${formatPercent(limit)} iskonto`
}

/**
 * Reddederken dönen metin — üç uç ve iki ekran aynı cümleyi kullanır.
 * Tutar da yazılır: "%50" soyuttur, kasiyerin ihtiyacı "en fazla 300,00 ₺"dir.
 */
export function discountLimitError(limit: DiscountLimit, gross: number): string {
  if (limit === null) return "İskonto tavanı aşıldı"
  if (limit === 0) return "Bu işletmede iskonto verilmiyor (tavan %0)."
  const max = maxDiscountFor(gross, limit)
  const suffix = max !== null && gross > 0 ? ` — bu hesapta en fazla ${money(max)}` : ""
  return `İskonto tavanı %${formatPercent(limit)}${suffix}.`
}

/** %50 · %12,5 — anlamsız sıfır basmadan. */
export function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",")
}
