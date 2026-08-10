import { cache } from "react"
import { Role } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { getSession } from "@/lib/auth/session"
import { getManagedBranches } from "@/lib/auth/branch-access"

export interface UserCompanyContext {
  companyId: string
  companySlug: string
  /** Resmi ünvan (belgelerde basılan ad). */
  companyName: string
  /** Ünvandan ayrı, arayüzde parantez içinde gösterilen kısa şube ismi. */
  companyBranchName: string | null
  role: Role
  isActive: boolean
  isEDonusumEnabled: boolean
  disabledModules: string[]
  /**
   * Kısıtlı çalışan izinleri. BOŞ = kısıt yok (rolün tüm sayfaları) — bkz.
   * lib/page-access.ts. Firma bazındadır: aynı kullanıcı başka şubede kısıtsız olabilir.
   */
  allowedPaths: string[]
  writablePaths: string[]
  /** Firmanın tanımladığı özel rol (varsa). Doluysa yetki tavanı değişir. */
  customRoleId: string | null
  customRoleName: string | null
  createdAt: Date
  // Üyelik DEĞİL; ana firmasının ADMIN'i olduğu için erişilen alt şube.
  isBranch?: boolean
  parentCompanyId?: string | null
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
      allowedPaths: string[]
      writablePaths: string[]
      customRoleId: string | null
      customRole: { id: string; name: string; allowedPaths: string[]; writablePaths: string[] } | null
      createdAt: Date
      company: {
        id: string
        slug: string
        name: string
        branchName: string | null
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
            allowedPaths: true,
            writablePaths: true,
            customRoleId: true,
            customRole: {
              select: { id: true, name: true, allowedPaths: true, writablePaths: true },
            },
            createdAt: true,
            company: {
              select: {
                id: true,
                slug: true,
                name: true,
                branchName: true,
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
    companyBranchName: entry.company.branchName ?? null,
    role: entry.role,
    isActive: entry.company.isActive,
    isEDonusumEnabled: entry.company.isEDonusumEnabled,
    disabledModules: entry.company.disabledModules ?? [],
    // Özel rol varsa yetki ONDAN gelir; üyelikteki listeler o durumda okunmaz.
    // Rol silinmişse (customRoleId null'a düşer) üyelik enum rolüne geri döner —
    // yani yetkisiz kalmaz ama özel yetkilerini kaybeder, bilinçli davranış.
    allowedPaths: entry.customRole?.allowedPaths ?? entry.allowedPaths ?? [],
    writablePaths: entry.customRole?.writablePaths ?? entry.writablePaths ?? [],
    customRoleId: entry.customRole?.id ?? null,
    customRoleName: entry.customRole?.name ?? null,
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
      companyBranchName: b.branchName,
      role: Role.ADMIN,
      isActive: true,
      isEDonusumEnabled: b.isEDonusumEnabled,
      disabledModules: b.disabledModules,
      // Şube erişimi ana firmanın ADMIN'liğinden doğar, üyelik satırı yoktur —
      // dolayısıyla tutunacak bir izin kaydı da yok: bu bağlam her zaman kısıtsız.
      allowedPaths: [],
      writablePaths: [],
      customRoleId: null,
      customRoleName: null,
      createdAt: new Date(0),
      isBranch: true,
      parentCompanyId: b.parentCompanyId,
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
