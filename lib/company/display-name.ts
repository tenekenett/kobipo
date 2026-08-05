/**
 * Firma seçici / şube listelerinde gösterilecek ad.
 *
 * `name` resmi ÜNVAN'dır ("ABC GIDA SAN. VE TİC. LTD. ŞTİ.") ve bir tüzel kişinin tüm
 * şubelerinde aynıdır → seçicide şubeler birbirinden ayırt edilemiyordu. `branchName`
 * bunun için tutulan kısa arayüz adıdır ve ünvanın yanına parantez içinde eklenir:
 *
 *   ABC GIDA SAN. VE TİC. LTD. ŞTİ. (Kadıköy)
 *
 * Yalnızca ARAYÜZ içindir — fatura/e-belge içeriğinde her zaman `name` (ünvan) kullanılır.
 */
export function companyDisplayName(
  company: { name: string; branchName?: string | null } | null | undefined
): string {
  if (!company) return ""
  const branch = company.branchName?.trim()
  return branch ? `${company.name} (${branch})` : company.name
}
