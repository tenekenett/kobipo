import { redirect } from "next/navigation"

export default async function FinansMutabakatRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  redirect(company ? `/banka/mutabakat?company=${encodeURIComponent(company)}` : "/banka/mutabakat")
}
