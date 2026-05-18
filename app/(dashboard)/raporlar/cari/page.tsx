import { redirect } from "next/navigation"

export default async function RaporlarCariRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  redirect(
    company
      ? `/raporlar/cari-yaslandirma?company=${encodeURIComponent(company)}`
      : "/raporlar/cari-yaslandirma"
  )
}
