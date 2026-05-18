import { redirect } from "next/navigation"

export default async function CekPortfoyuRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  const qs = new URLSearchParams()
  qs.set("tab", "checks")
  if (company) qs.set("company", company)
  redirect(`/cek-senet?${qs.toString()}`)
}
