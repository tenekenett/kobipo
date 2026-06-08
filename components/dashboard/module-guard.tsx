"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Lock } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { moduleKeyForPath } from "@/components/dashboard/nav-config"

/**
 * Kapalı bir modülün sayfasına URL ile gidildiğinde içerik yerine bilgi ekranı gösterir.
 * Menü gizlemeyi (nav.tsx) route düzeyinde tamamlar. Selected company çözülmeden engelleme
 * yapılmaz (yanlış pozitif olmaması için).
 */
export function ModuleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { selectedCompany } = useDashboardCompany()

  const moduleKey = moduleKeyForPath(pathname)
  const blocked =
    !!moduleKey &&
    !!selectedCompany &&
    (selectedCompany.disabledModules ?? []).includes(moduleKey)

  if (blocked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-kobipo-border bg-white p-8 text-center dark:border-border dark:bg-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-kobipo-pale text-kobipo-blue dark:bg-primary/15 dark:text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-kobipo-navy dark:text-foreground">
            Bu modül kapalı
          </h1>
          <p className="mt-2 text-sm text-kobipo-gray dark:text-muted-foreground">
            Bu modül firmanız için kapatılmış. Erişim açmak için sistem yöneticinizle iletişime
            geçin.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-block rounded-lg bg-kobipo-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Panele dön
          </Link>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
