// Kobipo'nun KENDİ sattığı ürünlerde (kontör paketi, abonelik paketi, à la carte
// kota kalemleri) KDV matematiği.
//
// TEMEL KURAL: Kobipo'nun ilan ettiği fiyatlar KDV DAHİL'dir. Müşteri ekranda ne
// görüyorsa PayTR'da o tutar çekilir ve faturanın ÖDENECEK TUTARI da odur. Matrah ile
// KDV bu tutardan iç yüzdeyle ayrıştırılır — fiyatın üzerine KDV eklenmez.

/** Fiyatların KDV dahil tutulduğunu belgeleyen bayrak. Ayrıştırma buna göre yapılır. */
export const KOBIPO_PRICES_INCLUDE_VAT = true

/**
 * Sistem varsayılanı KDV oranı (%). Paket kaydında `vatRate` NULL ise bu kullanılır.
 * Türkiye genel oranı 2023'ten beri %20; istisnalı/indirimli bir ürün satılacaksa
 * oran paket bazında (KontorPackage.vatRate / Plan.vatRate) verilir.
 */
export const KOBIPO_DEFAULT_VAT_RATE = 20

/** Paket kaydındaki oranı (Decimal | number | null) sayıya çevirir; yoksa varsayılan. */
export function resolveVatRate(raw: unknown): number {
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : KOBIPO_DEFAULT_VAT_RATE
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export type VatSplit = {
  /** KDV matrahı (mal/hizmet bedeli). */
  net: number
  /** Hesaplanan KDV. */
  vat: number
  /** net + vat — belgenin vergiler dahil toplamı. */
  total: number
  /**
   * Dip toplam yuvarlaması: `gross - total`. KDV'ye GİRMEZ, yalnız ödenecek tutara
   * eklenir (Invoice.payableRoundingAmount / Mysoft payableRoundingAmount).
   * Neredeyse her zaman 0'dır; yalnız iç yüzde ayrıştırması kuruşta tutmadığında
   * ±0,01 olur (ör. KDV dahil 10,05 ₺ @%20).
   */
  rounding: number
  /** Tahsil edilen tutar — daima `total + rounding`. */
  gross: number
  vatRate: number
}

/**
 * KDV DAHİL bir tutarı matrah + KDV'ye ayrıştırır.
 *
 * Yuvarlama sırası Mysoft provider'ının satır matematiğiyle AYNI tutulur
 * (`taxableAmt = round2(net)`, `rowVat = round2(taxable * rate / 100)`), böylece
 * Kobipo'daki Invoice kaydı ile GİB'e giden belge kuruşu kuruşuna örtüşür. Aradaki
 * olası kuruş farkı KDV'ye karıştırılmaz, `rounding` olarak dip toplama yazılır —
 * ödenecek tutarın tahsil edilen tutardan sapmaması bundan önemlidir.
 */
export function splitVatInclusive(grossAmount: number, rate: number): VatSplit {
  const gross = round2(Number(grossAmount) || 0)
  const vatRate = resolveVatRate(rate)

  if (vatRate <= 0) {
    return { net: gross, vat: 0, total: gross, rounding: 0, gross, vatRate: 0 }
  }

  const net = round2(gross / (1 + vatRate / 100))
  const vat = round2((net * vatRate) / 100)
  const total = round2(net + vat)

  return { net, vat, total, rounding: round2(gross - total), gross, vatRate }
}
