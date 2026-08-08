"use client"

import { usePathname } from "next/navigation"
import { Lock, ShoppingCart } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { CompanyLink } from "@/components/dashboard/company-link"
import { moduleKeyForPath } from "@/components/dashboard/nav-config"
import { MANAGEABLE_MODULES } from "@/lib/modules"

/**
 * Kapalı bir modülün sayfasına URL ile gidildiğinde içerik yerine bilgi ekranı gösterir.
 * Menü gizlemeyi (nav.tsx) route düzeyinde tamamlar. Selected company çözülmeden engelleme
 * yapılmaz (yanlış pozitif olmaması için).
 *
 * Modül = satın alınan şey olduğu için mesaj "yöneticinize sorun" değil "bu modülü satın
 * alın"dır; dil `locked-account.tsx` ile aynı. Satın alma yetkisi ADMIN'dedir, diğer
 * roller yöneticiye yönlendirilir.
 */
export function ModuleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { selectedCompany, userRole } = useDashboardCompany()

  const moduleKey = moduleKeyForPath(pathname)
  const blocked =
    !!moduleKey &&
    !!selectedCompany &&
    (selectedCompany.disabledModules ?? []).includes(moduleKey)

  if (blocked) {
    const module = MANAGEABLE_MODULES.find((m) => m.key === moduleKey)
    const canPurchase = userRole === "ADMIN"

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-kobipo-border bg-white p-8 text-center dark:border-border dark:bg-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-kobipo-pale text-kobipo-blue dark:bg-primary/15 dark:text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-kobipo-navy dark:text-foreground">
            {module ? `${module.label} modülü kapalı` : "Bu modül kapalı"}
          </h1>
          <p className="mt-2 text-sm text-kobipo-gray dark:text-muted-foreground">
            {canPurchase
              ? `Kobipo modüllerden oluşur; yalnızca ihtiyacınız olanların bedelini ödersiniz.${
                  module ? ` ${module.label}: ${module.description}.` : ""
                } Bu modülü aldığınızda ilgili menüler anında açılır.`
              : "Bu modül firmanız için kapalı. Modül satın alma yetkisi firma yöneticisindedir; lütfen yöneticinizle iletişime geçin."}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {canPurchase && (
              <CompanyLink
                href="/ayarlar/abonelik"
                className="inline-flex items-center gap-2 rounded-lg bg-kobipo-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <ShoppingCart className="h-4 w-4" />
                Bu modülü satın al
              </CompanyLink>
            )}
            <CompanyLink
              href="/dashboard"
              className={
                canPurchase
                  ? "inline-block rounded-lg border border-kobipo-border px-4 py-2 text-sm font-medium text-kobipo-navy hover:bg-kobipo-pale/60 dark:border-border dark:text-foreground dark:hover:bg-muted/40"
                  : "inline-block rounded-lg bg-kobipo-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              }
            >
              Panele dön
            </CompanyLink>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
