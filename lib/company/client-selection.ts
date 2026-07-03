export type AccessibleCompany = {
  id: string
  slug?: string
  name?: string
}

/**
 * URL'deki `company` param'ı (slug VEYA cuid olabilir) ile eşleşen firmayı bulur.
 * SEF sonrası URL slug taşır; eski bookmark'lar cuid taşıyabilir — ikisini de eşler.
 */
export function findCompanyByParam<T extends AccessibleCompany>(
  companies: T[],
  param: string | null | undefined
): T | null {
  if (!param) return null
  return companies.find((c) => c.id === param || c.slug === param) ?? null
}

/** Bir firma id'sinin (cuid) okunabilir slug'ını döner; bilinmiyorsa id'ye düşer. */
export function companySlugForId(
  companies: AccessibleCompany[],
  id: string | null | undefined
): string {
  if (!id) return ""
  return companies.find((c) => c.id === id)?.slug ?? id
}

export function isAccessibleCompanyId(
  companies: AccessibleCompany[],
  companyId: string | null | undefined
) {
  if (!companyId) return false
  return companies.some((company) => company.id === companyId)
}

export function getFirstAccessibleCompanyId(companies: AccessibleCompany[]) {
  return companies[0]?.id ?? null
}

export function withCompanyQuery(search: string, companyId: string) {
  const params = new URLSearchParams(search)
  params.set("company", companyId)
  return `?${params.toString()}`
}
