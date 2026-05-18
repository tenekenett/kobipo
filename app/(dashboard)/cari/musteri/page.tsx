import { redirect } from "next/navigation"

export default async function MusteriRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  const qs = new URLSearchParams()
  qs.set("tab", "customers")
  if (company) qs.set("company", company)
  redirect(`/cari?${qs.toString()}`)
}
