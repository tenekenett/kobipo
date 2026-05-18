import { redirect } from "next/navigation"

export default async function RaporlarVergiRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  redirect(
    company ? `/raporlar/vergiler?company=${encodeURIComponent(company)}` : "/raporlar/vergiler"
  )
}
