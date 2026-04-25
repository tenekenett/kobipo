import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"

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

export async function ensureCompanyAccess(companyId: string) {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }

  const userCompany = await prisma.userCompany.findFirst({
    where: {
      userId: user.id,
      companyId: companyId,
    },
  })

  if (!userCompany) {
    throw new Error("Access denied to this company")
  }

  return userCompany
}

