/**
 * Panel linklerine aktif firma/şube param'ını ekler.
 *
 * Seçili firma/şube bağlamının TEK kaynağı URL'deki `?company=` param'ıdır: panel
 * sayfaları companyId'yi `searchParams.get("company")` ile okur. Param taşımayan bir
 * link bağlamı düşürür; kullanıcı sessizce başka bir firmanın verisine geçer. Bu yüzden
 * panel içi her link bu yardımcıdan geçmelidir.
 *
 * `company` slug (SEF) ya da cuid olabilir — çözümü `resolveCompanyId` /
 * `findCompanyByParam` yapar, burada olduğu gibi taşınır.
 *
 * Var olan query ve hash korunur: `withCompanyHref("/restoran/raporlar?rapor=gun-sonu", "x")`
 * → `/restoran/raporlar?rapor=gun-sonu&company=x`
 */
export function withCompanyHref(href: string, company: string | null | undefined): string {
  if (!company) return href

  const hashIndex = href.indexOf("#")
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : ""
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href

  const queryIndex = withoutHash.indexOf("?")
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "")
  params.set("company", company)

  return `${path}?${params.toString()}${hash}`
}
