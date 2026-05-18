import { redirect } from "next/navigation"

export default async function GelenEFaturalarRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  redirect(company ? `/e-donusum?company=${encodeURIComponent(company)}` : "/e-donusum")
}
