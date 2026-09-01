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
  globalDiscountTotal: number
  /** Genel iskontoyla AÇIKLANAMAYAN kalan (kayıtlı toplamı bozuk belgeler). */
  unexplained: number
  /** Ekranda ve dosyada aynen basılan açıklama. */
  text: string
}

/**
 * "Detaylı Faturalar" toplamı neden "Faturalar" toplamını tutmuyor.
 *
 * İki sayfa aynı belgeleri sayar ama farklı seviyeden: kalem sayfası satırların,
 * fatura sayfası belgenin kayıtlı toplamının toplamıdır. Fatura GENELİNE uygulanan
 * iskonto kalem satırlarına dağıtılmadığı için fark normaldir — ama söylenmezse
 * kullanıcı "rakamlar tutmuyor" der. Kalanı (varsa) kayıtlı toplamı kalemleriyle
 * uyuşmayan belgelerden gelir; onu da saklamak yerine ayrıca yazarız.
 *
 * Fark yoksa `null`: temiz veride ne ekrana ne dosyaya uyarı basılır.
 */
export function describeLineTotalGap(totals: {
  totalAmount: number
  linesTotal: number
  globalDiscountTotal: number
}): LineTotalGap | null {
  const difference = totals.totalAmount - totals.linesTotal
  if (Math.abs(difference) < 0.01) return null

  const unexplained = difference + totals.globalDiscountTotal
  const parts = [
    `Kalem toplamı ${TL(totals.linesTotal)}, Faturalar sayfasının toplamı ${TL(totals.totalAmount)} — fark ${TL(Math.abs(difference))}.`,
  ]
  if (Math.abs(totals.globalDiscountTotal) >= 0.01) {
    parts.push(
      `Bunun ${TL(Math.abs(totals.globalDiscountTotal))} kadarı fatura geneline uygulanan iskontodur; kalem satırlarına dağıtılmaz.`
    )
  }
  if (Math.abs(unexplained) >= 0.01) {
    parts.push(
      `Kalan ${TL(Math.abs(unexplained))} ise kayıtlı toplamı kalemleriyle uyuşmayan belgelerden gelir (fatura kayıtları kontrol edilmeli).`
    )
  }

  return {
    difference,
    linesTotal: totals.linesTotal,
    invoiceTotal: totals.totalAmount,
    globalDiscountTotal: totals.globalDiscountTotal,
    unexplained,
    text: parts.join(" "),
  }
}
