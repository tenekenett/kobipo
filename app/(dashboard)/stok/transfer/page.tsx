import { redirect } from "next/navigation"

export default async function StokTransferRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  redirect(company ? `/depolar/transfer?company=${encodeURIComponent(company)}` : "/depolar/transfer")
}
