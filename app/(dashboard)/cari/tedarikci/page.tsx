import { redirect } from "next/navigation"

export default async function TedarikciRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  const qs = new URLSearchParams()
  qs.set("tab", "suppliers")
  if (company) qs.set("company", company)
  redirect(`/cari?${qs.toString()}`)
}
