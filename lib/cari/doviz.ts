/**
 * DÖVİZLİ FATURANIN CARİDEKİ TL KARŞILIĞI — tek kural (2026-10-09, muhasebe eksik turu B6).
 *
 * Cari bakiyeleri TL tutulur. Dövizli fatura (ihracat, dövizli alış) cariye FATURANIN
 * KURUYLA girer: tutar × `exchangeRate`. Bugüne kadar bakiyenin altı kaynağı da
 * (liste, kart uçları, ekstre, yaşlandırma, arşiv kapısı, tarih itibarıyla bakiye)
 * para birimine bakmıyordu: 100 USD'lik fatura cariye 100 TL giriyordu.
 *
 *   fatura toplamı          × fatura kuru
 *   kasasız ödeme (döviz)    × fatura kuru   (bakiye kapama — fatura kuruyla kapanır)
 *   kasaya bağlı ödeme       hareketin TL tutarı (paranın gerçek TL karşılığı)
 *
 * Tahsilat günün kuruyla TL olarak kasaya girer; fatura kuruyla aradaki fark carinin
 * bakiyesinde KUR FARKI olarak görünür kalır (gizlenmez) — bakiye kapama ya da kur farkı
 * faturasıyla kapatılır. Muhasebe defteri aynı rakamı tutar (120 = cari bakiyesi).
 *
 * Saf modül (istemci de okur); ham SQL karşılığı `doviz-sql.ts`.
 *
 * Kuru girilmemiş dövizli faturada kur 1 sayılır (eski davranış): borcu sessizce düşürmek
 * yerine görünür kalsın; KDV raporu bunları ayrıca sayıp ekrana yazar (kdv-kural.ts).
 */

export function faturaKuru(inv: { currency?: string | null; exchangeRate?: unknown }): number {
  const pb = String(inv.currency || "TRY").toUpperCase()
  if (pb === "TRY") return 1
  const kur = Number(inv.exchangeRate)
  return Number.isFinite(kur) && kur > 0 ? kur : 1
}

/** Faturanın TL karşılığı (toplam ya da kasasız ödeme tutarı × fatura kuru). */
export const tlKarsiligi = (tutar: unknown, inv: { currency?: string | null; exchangeRate?: unknown }) =>
  Math.round(Number(tutar ?? 0) * faturaKuru(inv) * 100) / 100
