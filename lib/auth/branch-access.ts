import { prisma } from "@/lib/db/prisma"

/**
 * Parent-admin şube erişimi için paylaşımlı yardımcılar.
 *
 * Model: bir kullanıcı, ADMIN olduğu bir firmanın alt şubelerini (parentCompanyId)
 * de yönetebilir/erişebilir — o şubeye doğrudan üye olmasa bile. Şube müdürü ataması,
 * şube context erişimi ve şube detayları bu yetkiye dayanır.
 */

export type ManageableCompany = {
  id: string
  name: string
  parentCompanyId: string | null
}

export type ManagedBranch = {
  id: string
  slug: string
  name: string
  parentCompanyId: string
  parentName: string | null
  isEDonusumEnabled: boolean
  disabledModules: string[]
}

/**
 * Kullanıcının yönetebildiği firma/şubeyi döner (yoksa null):
 * - firmanın DOĞRUDAN ADMIN'i ise, ya da
 * - (şube ise) ana firmasının ADMIN'i ise.
 */
export async function canManageCompany(
  userId: string,
  companyId: string
): Promise<ManageableCompany | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, parentCompanyId: true },
  })
  if (!company) return null

  const direct = await prisma.userCompany.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true },
  })
  if (direct?.role === "ADMIN") return company

  if (company.parentCompanyId) {
    const parent = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId: company.parentCompanyId } },
      select: { role: true },
    })
    if (parent?.role === "ADMIN") return company
  }

  return null
}

/**
 * Kullanıcının ADMIN olduğu firmaların AKTİF alt şubeleri — kullanıcının halihazırda
 * doğrudan üye OLMADIĞI olanlar (üye olduğu şubeler zaten context'te yer alır).
 */
export async function getManagedBranches(userId: string): Promise<ManagedBranch[]> {
  const memberships = await prisma.userCompany.findMany({
    where: { userId },
    select: { companyId: true, role: true },
  })
  const memberCompanyIds = new Set(memberships.map((m) => m.companyId))
  const adminCompanyIds = memberships
    .filter((m) => m.role === "ADMIN")
    .map((m) => m.companyId)

  if (adminCompanyIds.length === 0) return []

  const adminNameById = new Map(
    (
      await prisma.company.findMany({
        where: { id: { in: adminCompanyIds } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name])
  )

  const branches = await prisma.company.findMany({
    where: { parentCompanyId: { in: adminCompanyIds }, isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      parentCompanyId: true,
      isEDonusumEnabled: true,
      disabledModules: true,
    },
    orderBy: { name: "asc" },
  })

  return branches
    .filter((b) => !memberCompanyIds.has(b.id))
    .map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      parentCompanyId: b.parentCompanyId as string,
      parentName: adminNameById.get(b.parentCompanyId ?? "") ?? null,
      isEDonusumEnabled: b.isEDonusumEnabled,
      disabledModules: b.disabledModules ?? [],
    }))
}
