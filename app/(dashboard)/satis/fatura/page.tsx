import { redirect } from "next/navigation"

export default async function SatisFaturaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  const qs = new URLSearchParams()
  qs.set("type", "SALES")
  if (company) qs.set("company", company)
  redirect(`/faturalar?${qs.toString()}`)
}
