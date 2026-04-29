export type AccessibleCompany = {
  id: string
  name?: string
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
