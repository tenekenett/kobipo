import { redirect } from "next/navigation"
import { withCompanyHref } from "@/lib/company/href"

// Reçete ekranı Restoran & Kafe grubuna taşındı (/restoran/menu): kurulum ve
// kullanım artık aynı menü grubunda. Bu adres, daha önce paylaşılmış linkler
// kırılmasın diye yönlendirme olarak korunuyor.
//
// NOT: Taşınan yalnız EKRAN. Reçete mantığı (lib/stock/recipe*.ts) Stok'ta
// kalıyor — reçete restorana özgü bir kavram değil (PLAN.md "Adım 1").
//
// `?company=` aynen taşınır; aksi halde yönlendirme seçili şubeyi düşürür.
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const company = typeof params.company === "string" ? params.company : null
  redirect(withCompanyHref("/restoran/menu", company))
}
