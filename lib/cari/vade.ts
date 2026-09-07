/**
 * FATURA VADESİNİ CARİ KARTINDAN TÜRETME.
 *
 * ── Neden bu alan boş kalıyor ve neden önemli ───────────────────────────────
 * `Invoice.dueDate` canlı veride neredeyse hiç dolmuyor: en büyük firmada 135
 * belgenin %0'ında, ikincisinde %2'sinde yazılı (ölçüm 2026-09-07). Boş vade
 * tek bir alanı değil, ÜÇ katmanı birden kör ediyor:
 *
 *   yaşlandırma  → belge hangi kovaya düşecek
 *   projeksiyon  → para hangi hafta gelecek (vadesiz tutar eğriye HİÇ girmez)
 *   tahsilat     → gecikme = ödeme günü − VADE; vade yoksa gecikme de yok
 *
 * Ölçülen büyüklük: çek/senet eklendikten sonra bile dört firmada 1.379.420 TL
 * "vadesi tanımsız" rafında duruyor — eğriye eklenen 1.167.000 TL'den fazlası.
 *
 * ── Neden formda türetiliyor, sunucuda değil ────────────────────────────────
 * Katalogun veri girişi kuralı (docs/otomasyonlar/KATALOG.md §2): "türet → anın
 * içinde ve DOLDURULMUŞ sor". Vade sunucuda sessizce yazılsaydı kullanıcı neyi
 * kabul ettiğini görmezdi — ve bu alan e-Fatura/e-Arşiv gövdesine de gidiyor
 * (`app/api/e-donusum/invoices/route.ts`), yani GİB'e giden resmî belgede
 * müşteriye taahhüt edilen tarihtir. Bu yüzden değer forma ÖNERİ olarak
 * yazılır: kullanıcı görür, gerekirse değiştirir, kaynağı da kutunun altında
 * yazar. Elle girilen vadeye bir daha dokunulmaz.
 *
 * ── Saat dilimi ─────────────────────────────────────────────────────────────
 * Girdi ve çıktı, tarih kutusunun biçimi olan YYYY-MM-DD. String `new Date()`e
 * verilmez: "2026-09-07" UTC gece yarısı olarak ayrıştırılır ve TSİ'de bir gün
 * geriye kayabilir (bkz. `lib/format.ts` → `istanbulDay` başlığı). Parçalar
 * ayrı ayrı okunup YEREL tarih kurulur; ay/yıl taşmasını `new Date` çözer.
 */

import { toDateInput } from "@/lib/format"

const TARIH_BICIMI = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Fatura tarihine carinin ödeme vadesini ekler.
 *
 * Türetilemeyen her durumda `null` döner — çağıran taraf o zaman alanı boş
 * bırakır. "Bilmiyorsan uydurma" kuralı: yanlış bir vade, boş vadeden kötüdür
 * çünkü resmî belgeye yazılır.
 */
export function vadeTarihiTuret(
  faturaTarihi: string,
  vadeGunu: number | null | undefined
): string | null {
  if (typeof vadeGunu !== "number" || !Number.isFinite(vadeGunu) || vadeGunu <= 0) return null

  const parcalar = TARIH_BICIMI.exec(faturaTarihi ?? "")
  if (!parcalar) return null

  const yil = Number(parcalar[1])
  const ay = Number(parcalar[2])
  const gun = Number(parcalar[3])
  if (ay < 1 || ay > 12 || gun < 1 || gun > 31) return null

  // Gün toplamı doğrudan `new Date`e veriliyor: 25 Ağustos + 30 gün ay ve yıl
  // sınırını kendi aşar. Elle mod alsaydık Aralık→Ocak geçişinde yıl kaybolurdu.
  const vade = new Date(yil, ay - 1, gun + Math.round(vadeGunu))
  if (Number.isNaN(vade.getTime())) return null

  return toDateInput(vade)
}
