import { redirect } from "next/navigation"

export default async function CekSenetRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  const tab = params.tab === "notes" ? "senet" : "cek"
  redirect(company ? `/cek-senet/${tab}?company=${encodeURIComponent(company)}` : `/cek-senet/${tab}`)
}
