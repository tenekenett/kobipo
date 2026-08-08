import { headers } from "next/headers"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { getUserContext, type UserCompanyContext } from "@/lib/auth/user-context"
import {
  MODULE_GATE_METHOD_HEADER,
  MODULE_GATE_PATH_HEADER,
  ModuleLockedError,
  isApiPathAllowed,
  requiredModulesForApiPath,
} from "@/lib/module-access"
import { cache } from "react"

export async function getCurrentCompany(companyId: string) {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }

  const userCompany = await prisma.userCompany.findFirst({
    where: {
      userId: user.id,
      companyId: companyId,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          taxNumber: true,
          taxOffice: true,
          address: true,
          city: true,
          country: true,
          phone: true,
          email: true,
          website: true,
          isEDonusumEnabled: true,
          invoiceSeriesPrefix: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  if (!userCompany) {
    throw new Error("Company not found or access denied")
  }

  return userCompany.company
}

export async function getUserCompanies() {
  const user = await getCurrentUser()
  if (!user) {
    return []
  }

  const userCompanies = await prisma.userCompany.findMany({
    where: {
      userId: user.id,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          taxNumber: true,
          taxOffice: true,
          address: true,
          city: true,
          country: true,
          phone: true,
          email: true,
          website: true,
          isEDonusumEnabled: true,
          invoiceSeriesPrefix: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  return userCompanies.map((uc) => uc.company)
}

/**
 * Sunucu tarafı MODÜL kapısı. Modül yalnızca satın almayla açıldığı için (bkz.
 * lib/billing/entitlements.ts) kapalı bir modülün ucu elle çağrıldığında da reddedilmeli
 * — menü gizleme ve ModuleGuard istemci tarafındadır, ücretli özelliği korumaz.
 *
 * Yalnız `/api/*` için çalışır: yolu kökteki proxy.ts header'a yazar, kural haritası
 * lib/module-access.ts'tedir. Sayfa render'ında header yoktur → kapı uygulanmaz, orada
 * ModuleGuard "Bu modül kapalı" ekranını gösterir.
 *
 * Süper-admin muaftır (destek/yönetim erişimi).
 */
async function assertModuleAccess(
  company: UserCompanyContext,
  isSuperAdmin: boolean
): Promise<void> {
  if (isSuperAdmin) return

  let pathname: string | null = null
  let method = "GET"
  try {
    const requestHeaders = await headers()
    pathname = requestHeaders.get(MODULE_GATE_PATH_HEADER)
    method = requestHeaders.get(MODULE_GATE_METHOD_HEADER) ?? "GET"
  } catch {
    // İstek kapsamı dışında (build, script, cron) çağrıldı — kapı uygulanmaz.
    return
  }

  if (!pathname) return
  if (isApiPathAllowed(pathname, method, company.disabledModules)) return

  // Mesajı "Access denied" ile başlar (route catch'leri 403'e onunla mapler); gövdeye
  // `code: "MODULE_LOCKED"` taşımak `lib/api/errors.ts → accessDeniedResponse`'un işi.
  throw new ModuleLockedError(requiredModulesForApiPath(pathname, method))
}

/**
 * Modül kapısını, isteğin KENDİ yolu yerine açıkça verilen bir yol için uygular.
 *
 * Kapı normalde `x-kobipo-path`'i okur; ama bazı uçlar hangi veriyi verecekleri bilgisini
 * yolda değil query'de taşır — ör. `/api/export?module=products`, `/api/export/products`
 * ile aynı veriyi döndürür ama o yolun kuralına takılmaz. Böyle bir uç karşılık gelen
 * "gerçek" yolu buraya sorar; kural tablosu (lib/module-access.ts) tek kaynak kalır.
 */
export async function assertModulePath(
  company: UserCompanyContext,
  pathname: string,
  method = "GET"
): Promise<void> {
  const context = await getUserContext()
  if (context?.isSuperAdmin) return
  if (isApiPathAllowed(pathname, method, company.disabledModules)) return
  throw new ModuleLockedError(requiredModulesForApiPath(pathname, method))
}

export const ensureCompanyAccess = cache(async function ensureCompanyAccess(
  companyId: string
): Promise<UserCompanyContext> {
  const context = await getUserContext()
  if (!context) {
    throw new Error("Unauthorized")
  }

  const match = context.companies.find((entry) => entry.companyId === companyId)
  if (match) {
    // Pasif firmaya normal kullanıcı (üye) erişemez; yalnızca super admin yönetim
    // amacıyla erişebilir. "Access denied" ifadesi API route catch'lerinde 403'e maplenir.
    if (!match.isActive && !context.isSuperAdmin) {
      throw new Error("Access denied: company is inactive")
    }
    await assertModuleAccess(match, context.isSuperAdmin)
    return match
  }

  if (!context.isSuperAdmin) {
    throw new Error("Access denied to this company")
  }

  // Super admin fallback: companies aren't pre-loaded, hit DB once for membership/role.
  const userCompany = await prisma.userCompany.findFirst({
    where: { userId: context.userId, companyId },
    include: {
      company: {
        select: {
          slug: true,
          name: true,
          branchName: true,
          isActive: true,
          isEDonusumEnabled: true,
          disabledModules: true,
        },
      },
    },
  })

  if (!userCompany) {
    throw new Error("Access denied to this company")
  }

  return {
    companyId: userCompany.companyId,
    companySlug: userCompany.company.slug,
    companyName: userCompany.company.name,
    companyBranchName: userCompany.company.branchName ?? null,
    role: userCompany.role,
    isActive: userCompany.company.isActive,
    isEDonusumEnabled: userCompany.company.isEDonusumEnabled,
    disabledModules: userCompany.company.disabledModules ?? [],
    createdAt: userCompany.createdAt,
  }
})

/**
 * Yazma (mutasyon) uçları için erişim + rol kontrolü. Salt-okuma rolü VIEWER reddedilir —
 * nav-config'te VIEWER yalnızca raporları görür, hiçbir yazma ekranında yer almaz; bu yüzden
 * veri-yazan uçlar VIEWER'a kapalıdır. "Access denied" ifadesi mevcut route catch'lerinde
 * 403'e maplenir; catch'i olmayan uçlarda istek yine (fail-closed) reddedilir. Modül-bazlı
 * ince kısıt (ör. SALES ↛ stok yazma) bu sürümde uygulanmaz, ayrıca ele alınır.
 */
export async function ensureCompanyWrite(
  companyId: string,
): Promise<UserCompanyContext> {
  const context = await ensureCompanyAccess(companyId)
  if (context.role === "VIEWER") {
    throw new Error("Access denied: read-only role (VIEWER)")
  }
  return context
}

