import { redirect } from "next/navigation"
import { withCompanyHref } from "@/lib/company/href"
import { canAccessRoute, landingPathFor, type PagePermissions } from "@/lib/page-access"
import type { UserRole } from "@/lib/middleware/authorization"

/**
 * Server component sayfaları için sayfa kapısı.
 *
 * NEDEN AYRI BİR KAPI GEREKİYOR: `/api/*` kapısı (ensureCompanyAccess) yalnız uçları
 * korur; veriyi Prisma'dan DOĞRUDAN çeken bir server sayfası oradan hiç geçmez.
 * İstemcideki `PermissionGuard` da yetmez — o yalnız çizimi durdurur, veri çoktan
 * RSC payload'ına yazılmış olur. Rol panoları ciro/kâr rakamı bastığı için fark
 * gerçek: kısıtlı bir kasiyer adres çubuğuna `/dashboard/sales` yazınca aylık satışı
 * görürdü.
 *
 * Kısıtsız üyelikte hiçbir şey yapmaz (bugünkü davranış).
 */
export function assertRouteAccessOrRedirect(
  company: UserRole,
  pathname: string,
  companyParam?: string | null
): void {
  const permissions = pagePermissionsOfRole(company)
  if (canAccessRoute(permissions, pathname)) return

  const landing = landingPathFor(permissions)
  // Döngü koruması: landingPathFor her zaman GÖRÜNÜR bir sayfa döndürür, ama liste
  // bozuksa (rol daralmış, izinler geçersiz kalmış) aynı yola yönlendirip sonsuz
  // döngü kurmaktansa istemci guard'ının bilgi ekranını göstermek daha iyi.
  if (landing === pathname) return

  redirect(withCompanyHref(landing, companyParam ?? company.companySlug ?? company.companyId))
}

export function pagePermissionsOfRole(company: UserRole): PagePermissions {
  return {
    role: company.role,
    allowedPaths: company.allowedPaths ?? [],
    writablePaths: company.writablePaths ?? [],
    custom: Boolean(company.customRoleId),
  }
}
