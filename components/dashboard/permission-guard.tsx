"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { ShieldOff } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { CompanyLink } from "@/components/dashboard/company-link"
import { canAccessRoute, landingPathFor, navHrefsForPath } from "@/lib/page-access"
import { navPage } from "@/lib/nav/pages"

/**
 * Kısıtlı bir çalışan izinsiz bir sayfanın adresine gittiğinde içerik yerine bilgi
 * ekranı gösterir. `ModuleGuard`ın kardeşi ve ondan SONRA çalışır: "modül kapalı"
 * (satın alınmamış) ile "yetkin yok" (yönetici vermemiş) farklı şeylerdir.
 *
 * Bu bir UX katmanıdır, güvenlik sınırı DEĞİL: veri sunucudan gelir ve asıl kapı
 * orada (lib/page-access.ts + ensureCompanyAccess). Buradaki ekran, kullanıcının
 * boş/yarım bir sayfayla veya bir yığın 403 hatasıyla karşılaşmasını önler.
 *
 * Seçili firma çözülmeden engelleme yapılmaz (yanlış pozitif olmasın).
 */
export function PermissionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { selectedCompany, pagePermissions } = useDashboardCompany()

  const blocked = !!selectedCompany && !canAccessRoute(pagePermissions, pathname, searchParams)

  if (!blocked) return <>{children}</>

  const owners = navHrefsForPath(pathname, searchParams)
  const label = owners.map((href) => navPage(href)?.label).find(Boolean)
  const landing = landingPathFor(pagePermissions, {
    disabledModules: selectedCompany?.disabledModules ?? [],
    isEDonusumEnabled: selectedCompany?.isEDonusumEnabled !== false,
  })

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-kobipo-border bg-white p-8 text-center dark:border-border dark:bg-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <ShieldOff className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-kobipo-navy dark:text-foreground">
          {label ? `"${label}" sayfasına yetkiniz yok` : "Bu sayfaya yetkiniz yok"}
        </h1>
        <p className="mt-2 text-sm text-kobipo-gray dark:text-muted-foreground">
          Hesabınız yalnızca belirli sayfalar için yetkilendirilmiş. Bu sayfaya erişmeniz
          gerekiyorsa firma yöneticinizden yetki talep edin.
        </p>

        <div className="mt-6">
          <CompanyLink
            href={landing}
            className="inline-block rounded-lg bg-kobipo-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Yetkili olduğum sayfaya dön
          </CompanyLink>
        </div>
      </div>
    </div>
  )
}
