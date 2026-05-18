import { redirect } from "next/navigation"

export default async function UrunlerRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : undefined
  redirect(company ? `/stok?company=${encodeURIComponent(company)}` : "/stok")
}
