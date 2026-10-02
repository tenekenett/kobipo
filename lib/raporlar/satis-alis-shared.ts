/**
 * Satış / alış raporunun SAF parçaları: dönem sınırı ve kalem–fatura toplam farkı.
 *
 * `lib/raporlar/satis-alis.ts` en üstte Prisma'yı içe aktarıyor; oradan bir
 * FONKSİYON import eden istemci bileşeni Prisma'yı tarayıcı paketine sürükler
 * (bugüne kadar yalnız `import type` kullanıldığı için sorun çıkmamıştı). Bu
 * yüzden ekranın da sunucunun da çağırdığı saf mantık burada durur — aynı ayrım
 * `satis-alis-sections.ts`te de var.
 */

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

const TL = (value: number) =>
  `₺${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Ekrandan gelen `YYYY-MM-DD` aralığını Prisma tarih süzgecine çevirir.
 *
 * Bitiş tarihi `lte: new Date("2026-08-29")` diye uygulanıyordu; bu, o günün
 * SAAT 00:00'ı demektir. Saatiyle kaydedilen faturalar (ölçüldü: bir firmanın
 * 252 faturasının 62'si) dönemin son gününde listeden düşüyordu — "bitiş = bugün"
 * seçen kullanıcı bugünkü faturaların hiçbirini göremiyordu. Bitiş bu yüzden
 * ERTESİ GÜNÜN başına (`lt`) çevrilir. Gün sınırı UTC'dir: aylık kırılım da aynı
 * eksende hesaplanıyor.
 */
export function resolveReportDateFilter(
  startDate?: string | null,
  endDate?: string | null
): { gte?: Date; lt?: Date; lte?: Date } | undefined {
  if (!startDate && !endDate) return undefined

  const gte = startDate
    ? new Date(DAY_ONLY.test(startDate) ? `${startDate}T00:00:00.000Z` : startDate)
    : undefined

  if (!endDate) return { gte }
  // Saat taşıyan değer olduğu gibi uygulanır (uca elle verilebilir).
  if (!DAY_ONLY.test(endDate)) return { gte, lte: new Date(endDate) }

  const lt = new Date(`${endDate}T00:00:00.000Z`)
  lt.setUTCDate(lt.getUTCDate() + 1)
  return { gte, lt }
}

export type LineTotalGap = {
  /** Fatura toplamı − kalem toplamı. Sıfıra yakınsa fark yok sayılır. */
  difference: number
  linesTotal: number
  invoiceTotal: number
  /** Belge yuvarlaması: başlıkta durur, kaleme düşmez. */
  roundingTotal: number
  /** Kayıtlı toplamı kalemleriyle uyuşmayan belgeler (kalemsiz belge dahil). */
  mismatch: { count: number; amount: number }
  /** Kalan: satır başı kuruş yuvarlaması (fatura altı payın dağıtımı dahil). */
  kurus: number
  /** Ekranda ve dosyada aynen basılan açıklama. */
  text: string
}

/**
 * "Detaylı Faturalar" toplamı neden "Faturalar" toplamını tutmuyor.
 *
 * İki sayfa aynı belgeleri sayar ama farklı seviyeden: kalem sayfası satırların
 * belgedeki tutarının, fatura sayfası belgenin kayıtlı toplamının toplamıdır.
 * Fatura altı iskonto 2026-10-02'den beri satırlara dağıtılmış okunuyor
 * (`fatura-alti.ts`) ve farkın kaynağı olmaktan çıktı; kalan kaynaklar ayrı ayrı
 * söylenir: belge yuvarlaması, kayıtlı toplamı kalemleriyle uyuşmayan belgeler
 * (rapor belge belge sayar) ve satır başı kuruş yuvarlaması. (Öncesinde farkın
 * "genel iskonto" ile açıklanamayan kısmı uyuşmayan belgelere yazılıyordu; oysa
 * kalemler iskontonun KDV'sini de taşıyordu — Reypo'da 1.982 TL böyle yanlış
 * etiketlenmişti.)
 *
 * Fark yoksa `null`: temiz veride ne ekrana ne dosyaya uyarı basılır.
 */
export function describeLineTotalGap(totals: {
  totalAmount: number
  linesTotal: number
  roundingTotal: number
  mismatch: { count: number; amount: number }
}): LineTotalGap | null {
  const difference = totals.totalAmount - totals.linesTotal
  if (Math.abs(difference) < 0.01) return null

  const kurus = difference - totals.roundingTotal - totals.mismatch.amount
  const parts = [
    `Kalem toplamı ${TL(totals.linesTotal)}, Faturalar sayfasının toplamı ${TL(totals.totalAmount)} — fark ${TL(Math.abs(difference))}.`,
  ]
  if (Math.abs(totals.roundingTotal) >= 0.01) {
    parts.push(`${TL(Math.abs(totals.roundingTotal))} belge yuvarlamasıdır; kalemlere dağıtılmaz.`)
  }
  if (totals.mismatch.count > 0) {
    parts.push(
      `${TL(Math.abs(totals.mismatch.amount))} kayıtlı toplamı kalemleriyle uyuşmayan ${totals.mismatch.count} belgeden gelir (fatura kayıtları kontrol edilmeli).`
    )
  }
  if (Math.abs(kurus) >= 0.01) {
    parts.push(`${TL(Math.abs(kurus))} satır başı kuruş yuvarlamasıdır.`)
  }

  return {
    difference,
    linesTotal: totals.linesTotal,
    invoiceTotal: totals.totalAmount,
    roundingTotal: totals.roundingTotal,
    mismatch: totals.mismatch,
    kurus,
    text: parts.join(" "),
  }
}
