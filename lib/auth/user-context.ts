import { cache } from "react"
import { Role } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { getSession } from "@/lib/auth/session"
import { getManagedBranches } from "@/lib/auth/branch-access"

export interface UserCompanyContext {
  companyId: string
  companySlug: string
  companyName: string
  role: Role
  isActive: boolean
  isEDonusumEnabled: boolean
  disabledModules: string[]
  createdAt: Date
  // Üyelik DEĞİL; ana firmasının ADMIN'i olduğu için erişilen alt şube.
  isBranch?: boolean
  parentName?: string | null
  viaParent?: boolean
}

export interface UserContext {
  userId: string
  email: string
  name: string | null
  isSuperAdmin: boolean
  isBlogEditor: boolean
  companies: UserCompanyContext[]
}

export const getUserContext = cache(async function getUserContext(): Promise<UserContext | null> {
  const session = await getSession()

  if (!session?.user?.email) {
    return null
  }

  let user: {
    id: string
    email: string
    name: string | null
    isSuperAdmin: boolean
    isBlogEditor: boolean
    companies: Array<{
      role: Role
      createdAt: Date
      company: {
        id: string
        slug: string
        name: string
        isActive: boolean
        isEDonusumEnabled: boolean
        disabledModules: string[]
      }
    }>
  } | null = null

  try {
    user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        isBlogEditor: true,
        companies: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            createdAt: true,
            company: {
              select: {
                id: true,
                slug: true,
                name: true,
                isActive: true,
                isEDonusumEnabled: true,
                disabledModules: true,
              },
            },
          },
        },
      },
    })
  } catch (error) {
    console.error("getUserContext DB error:", error)
    return null
  }

  if (!user) {
    return null
  }

  const membershipCompanies: UserCompanyContext[] = user.companies.map((entry) => ({
    companyId: entry.company.id,
    companySlug: entry.company.slug,
    companyName: entry.company.name,
    role: entry.role,
    isActive: entry.company.isActive,
    isEDonusumEnabled: entry.company.isEDonusumEnabled,
    disabledModules: entry.company.disabledModules ?? [],
    createdAt: entry.createdAt,
  }))

  // Parent-admin erişimi: ADMIN olunan firmaların alt şubelerini SANAL ADMIN (üyelik
  // değil) olarak listenin SONUNA ekle — üyelikler önce kaldığı için varsayılan firma
  // seçimi bozulmaz. Hata olsa da çekirdek üyelik bağlamı korunur.
  let branchCompanies: UserCompanyContext[] = []
  try {
    const branches = await getManagedBranches(user.id)
    branchCompanies = branches.map((b) => ({
      companyId: b.id,
      companySlug: b.slug,
      companyName: b.name,
      role: Role.ADMIN,
      isActive: true,
      isEDonusumEnabled: b.isEDonusumEnabled,
      disabledModules: b.disabledModules,
      createdAt: new Date(0),
      isBranch: true,
      parentName: b.parentName,
      viaParent: true,
    }))
  } catch (error) {
    console.error("getUserContext managed branches error:", error)
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    isBlogEditor: user.isBlogEditor,
    companies: [...membershipCompanies, ...branchCompanies],
  }
})
