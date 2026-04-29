import { redirect } from "next/navigation"

type MusteriPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function MusteriRaporlariPage({ searchParams }: MusteriPageProps) {
  const params = searchParams ? await searchParams : undefined
  const company = params?.company
  const companyId = Array.isArray(company) ? company[0] : company
  const target = companyId
    ? `/raporlar/finansal?company=${encodeURIComponent(companyId)}`
    : "/raporlar/finansal"

  redirect(target)
}
