/**
 * Bordroda FİİLEN ödenen tutar — saf kural, istemci ve sunucu aynı yeri okur.
 *
 * `paidAmount` 2026-09-20'de eklendi: ödeme penceresi tutarı nete kilitliyordu.
 * Ondan önce ödenmiş kayıtlarda kolon NULL'dır ve net kadar ödendi sayılır;
 * ödenmemiş kayıtta ödenen tutar yoktur (0). "Ödenen" toplamları ve personel
 * kartındaki yıllık ödeme bu fonksiyondan geçer; net ile ödenen ayrışınca ekran
 * farkı GÖSTERİR, sessizce net basmaz.
 */
export type OdenenBordro = {
  status: string
  netSalary: unknown
  paidAmount?: unknown
}

/** PAID bordroda ödenen tutar; PENDING'de 0. */
export function odenenTutar(p: OdenenBordro): number {
  if (p.status !== "PAID") return 0
  const paid = p.paidAmount == null ? NaN : Number(p.paidAmount)
  return Number.isFinite(paid) ? paid : Number(p.netSalary) || 0
}

/** Ödenen tutar netten sapıyor mu (kuruş toleransıyla). */
export function odenenNettenFarkli(p: OdenenBordro): boolean {
  if (p.status !== "PAID") return false
  return Math.abs(odenenTutar(p) - (Number(p.netSalary) || 0)) >= 0.005
}
