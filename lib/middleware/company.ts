import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { getUserContext, type UserCompanyContext } from "@/lib/auth/user-context"
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
        select: { slug: true, name: true, isActive: true, isEDonusumEnabled: true, disabledModules: true },
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

