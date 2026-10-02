/**
 * FATURA ALTI İSKONTO / İLAVE — kalemin BELGEDEKİ karşılığı (saf, TS tarafı).
 *
 * Kalem satırı (`invoice_items`) KDV'sini, tevkifatını ve toplamını fatura altı
 * iskonto/ilave DAĞITILMADAN saklar; belge (başlık + GİB) dağıtılmış hâliyle
 * (`lib/invoice/document-totals.ts`). Kalemi okuyup TUTAR gösteren her rapor
 * kalemi buradan geçirir; geçirmezse iskontolu belgede ürünün cirosu ve KDV'si
 * belgedekinden fazla, ilaveli belgede eksik görünür.
 *
 * Kural ve gerekçe: `kdv-kural.ts` → `faturaAltiCarpanSql`. Bu dosya AYNI
 * kuralın TS karşılığıdır (SQL tarafı KDV raporunda); birini değiştiren ötekini
 * de değiştirir. Kısaca: dağıtım satır tutarıyla orantılı olduğu için her satır
 * aynı katsayıyla küçülür, maktu GEKAP ve ondan doğan KDV/tevkifat hariç.
 *
 * Kayıtlı kalem değerleri olduğu gibi okunur, vergi oranlardan YENİDEN
 * hesaplanmaz: eski kurallarla kaydedilmiş belgeler (ör. ÖTV kuralından önceki
 * kayıtlar) rapor ile fatura arasında yeni bir fark doğurmasın.
 */

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Katsayı için gereken kalem alanları — Prisma `Decimal` da kabul edilir. */
export type FaturaAltiKalemi = {
  quantity: unknown
  unitPrice: unknown
  discountAmount?: unknown
}

/** Belgedeki karşılık için gereken kalem alanları. */
export type KayitliKalem = FaturaAltiKalemi & {
  vatRate?: unknown
  withholdingRate?: unknown
  /** Maktu GEKAP tutarı (miktar × birim tutar). İskonto onu küçültmez. */
  gekapAmount?: unknown
  vatAmount?: unknown
  withholdingAmount?: unknown
  totalAmount?: unknown
}

/** Satırın kendi iskontosu düşülmüş tutarı — document-totals'ın `lineNet`i. */
export function kalemAraToplami(k: FaturaAltiKalemi): number {
  const brut = num(k.quantity) * num(k.unitPrice)
  return brut - Math.max(0, Math.min(num(k.discountAmount), brut))
}

/**
 * Belgenin katsayısı: (ara toplam − iskonto + ilave) / ara toplam. Kırpma
 * document-totals ile aynı (iskonto [0, ara toplam], ilave ≥ 0; ara toplam
 * sıfır/eksiyse 1). İskontosuz ve ilavesiz belgede tam olarak 1'dir.
 */
export function faturaAltiCarpani(
  kalemler: FaturaAltiKalemi[],
  belge: { globalDiscountAmount?: unknown; globalChargeAmount?: unknown },
): number {
  const iskonto = num(belge.globalDiscountAmount)
  const ilave = num(belge.globalChargeAmount)
  if (iskonto <= 0 && ilave <= 0) return 1
  const ara = kalemler.reduce((t, k) => t + kalemAraToplami(k), 0)
  if (ara <= 0) return 1
  return (ara - Math.min(Math.max(iskonto, 0), ara) + Math.max(ilave, 0)) / ara
}

export type BelgedekiKalem = {
  /** Fatura altı iskontonun bu satıra düşen payı; ilavede EKSİ. */
  faturaAltiPay: number
  /** Belgedeki mal/hizmet bedeli (satır ve fatura altı iskonto düşülmüş; ÖTV/GEKAP hariç). */
  net: number
  kdv: number
  tevkifat: number
  /** Belgedeki ödenecek satır toplamı (KDV dahil, tevkifat düşülmüş). */
  toplam: number
}

/**
 * Kalemin belgedeki tutarları: `(kayıtlı − sabit) × f + sabit`, sabit = maktu
 * GEKAP payı (`applyGlobalAdjustment` ile aynı ayrım). Yuvarlamaz: rapor
 * toplarken kuruş kaybı birikmesin, gösteren yuvarlar.
 */
export function belgedekiKalem(k: KayitliKalem, carpan: number): BelgedekiKalem {
  const ara = kalemAraToplami(k)
  const gekap = num(k.gekapAmount)
  const gekapKdv = (gekap * num(k.vatRate)) / 100
  const gekapTevkifat = (gekapKdv * num(k.withholdingRate)) / 100
  const olcek = (tutar: number, sabit: number) => (tutar - sabit) * carpan + sabit
  const net = ara * carpan
  return {
    faturaAltiPay: ara - net,
    net,
    kdv: olcek(num(k.vatAmount), gekapKdv),
    tevkifat: olcek(num(k.withholdingAmount), gekapTevkifat),
    toplam: olcek(num(k.totalAmount), gekap + gekapKdv - gekapTevkifat),
  }
}
