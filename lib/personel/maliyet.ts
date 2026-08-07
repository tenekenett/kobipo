/**
 * Vardiya süresinin para karşılığı — planlanan/çalışılan dakikadan işçilik maliyeti.
 *
 * BÖLEN NEDEN BURADA: saatlik ücret = aylık brüt ÷ 195 (haftalık 45 saat × 4,33
 * hafta). Aynı bölen bordro aktarım penceresinde de kullanılıyordu; iki yerde
 * ayrı sabit durursa aynı personel puantajda başka, bordroda başka saat ücretine
 * sahip olur ve fark kimsenin gözüne çarpmadan bordroya geçer. Tek tanım burada.
 *
 * Bölen SABİT AMA GÖRÜNÜR olmalı: ekranda `HOURLY_BASIS_LABEL` yazar, çünkü
 * aylık 225 saat (30 gün × 7,5) üzerinden hesaplayan işletmeler de vardır ve
 * aradaki ~%15 fark sessizce kabul ettirilemez.
 *
 * Hesap BRÜT ücret üzerindendir; SGK işveren payı ve işsizlik primi DAHİL
 * DEĞİLDİR — "işverene toplam maliyet" ayrı bir sorudur ve İK raporunda ayrıca
 * hesaplanır (lib/raporlar/personel.ts).
 */

/** Aylık normal çalışma süresi (saat): haftalık 45 saat × 4,33 hafta ≈ 195. */
export const MONTHLY_WORK_HOURS = 195

/** Ekranda maliyetin yanında duran açıklama — bölen görünür olmalı. */
export const HOURLY_BASIS_LABEL = `brüt maaş ÷ ${MONTHLY_WORK_HOURS} saat`

/**
 * Saatlik brüt ücret. Maaşı girilmemiş personelde `null` — sıfır DEĞİL:
 * "maliyeti yok" ile "maaşı bilinmiyor" toplamda aynı görünmemeli.
 */
export const hourlyRate = (grossMonthly: number | null | undefined): number | null => {
  if (grossMonthly == null || !Number.isFinite(grossMonthly) || grossMonthly <= 0) return null
  return grossMonthly / MONTHLY_WORK_HOURS
}

/** Verilen dakikanın brüt işçilik maliyeti; maaş bilinmiyorsa null. */
export const laborCost = (
  minutes: number,
  grossMonthly: number | null | undefined,
): number | null => {
  const rate = hourlyRate(grossMonthly)
  if (rate == null) return null
  return (rate * Math.max(0, minutes)) / 60
}

/**
 * İşçilik / ciro oranı (%). Restoran-kafede en çok bakılan gösterge; ciro sıfırsa
 * oran tanımsızdır (bölme değil, "veri yok") ve null döner.
 */
export const laborRatio = (cost: number, revenue: number | null): number | null => {
  if (revenue == null || revenue <= 0) return null
  return (cost / revenue) * 100
}
