import { prisma } from "@/lib/db/prisma"

/**
 * Üyelik olmadan gelen "yönetici erişimi" için paylaşımlı yardımcılar.
 *
 * Model: bir kullanıcı, ADMIN olduğu firmanın kendisine doğrudan üye OLMADIĞI hâlde
 * erişebildiği iki firma kümesi vardır (bkz. CLAUDE.md → "Şube ≠ firma"):
 *
 *   1. ŞUBELERİ — `parentCompanyId` ile bağlı, aynı tüzel kişi (mağaza gibi).
 *   2. HESABININ ÜYELERİ — `accountRootId` ile bağlı; satın alınmış EK FİRMALAR
 *      (ayrı VKN) ve onların şubeleri. Abonelik hesap kökünde durduğu için hesabın
 *      yöneticisi, hesaba ait her firmayı da yönetebilmeli.
 *
 * İki koşul birlikte gerekli: ek firmanın kendi ADMIN'i (kök admini olmayabilir) o
 * firmanın şubelerini 1. kuraldan görür; kök admini ise ek firmayı ve şubelerini 2.
 * kuraldan görür.
 */

export type ManageableCompany = {
  id: string
  name: string
  /** Şube ise ana firma; değilse null. */
  parentCompanyId: string | null
  /** Hesabın (faturalama) kökü; kök firmanın kendisinde null. */
  accountRootId: string | null
}

export type ManagedCompany = {
  id: string
  slug: string
  name: string
  /** Ünvandan ayrı kısa şube ismi (arayüzde parantez içinde gösterilir). */
  branchName: string | null
  /** Şube ise ana firma; hesaba bağlı ek firmada null. */
  parentCompanyId: string | null
  /** Şube mi (aynı VKN) yoksa hesaba bağlı ayrı firma mı (ek firma)? */
  isBranch: boolean
  /** Bağlı olunan firmanın adı: şubede ana firma, ek firmada hesap kökü. */
  parentName: string | null
  /** Hesabın kök firması (ek firma rozetini ve kota bağlamını çizmek için). */
  accountRootId: string | null
  isEDonusumEnabled: boolean
  disabledModules: string[]
  /** Hesap salt-okunur arşivde mi? (`Company.archivedAt`) */
  archivedAt: Date | null
}

/**
 * Kullanıcının yönetebildiği firmayı döner (yoksa null):
 * - firmanın DOĞRUDAN ADMIN'i ise, ya da
 * - (şube ise) ana firmasının ADMIN'i ise, ya da
 * - (hesaba bağlıysa) hesap kökünün ADMIN'i ise.
 */
export async function canManageCompany(
  userId: string,
  companyId: string
): Promise<ManageableCompany | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, parentCompanyId: true, accountRootId: true },
  })
  if (!company) return null

  const direct = await prisma.userCompany.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true },
  })
  if (direct?.role === "ADMIN") return company

  // Ana firma VE hesap kökü ayrı olabilir (ek firmanın şubesinde ikisi de dolu ve
  // farklıdır); ikisinden birinin ADMIN'i olmak yeter.
  const viaCompanyIds = [company.parentCompanyId, company.accountRootId].filter(
    (id): id is string => !!id
  )
  if (viaCompanyIds.length > 0) {
    const viaAdmin = await prisma.userCompany.findFirst({
      where: { userId, companyId: { in: viaCompanyIds }, role: "ADMIN" },
      select: { companyId: true },
    })
    if (viaAdmin) return company
  }

  return null
}

/**
 * Kullanıcının ADMIN'liğinden doğan AKTİF firmalar — doğrudan üye OLMADIKLARI
 * (üye olunanlar zaten context'te yer alır). Hem şubeler hem hesabın ek firmaları.
 */
export async function getManagedCompanies(userId: string): Promise<ManagedCompany[]> {
  const memberships = await prisma.userCompany.findMany({
    where: { userId },
    select: { companyId: true, role: true },
  })
  const memberCompanyIds = new Set(memberships.map((m) => m.companyId))
  const adminCompanyIds = memberships
    .filter((m) => m.role === "ADMIN")
    .map((m) => m.companyId)

  if (adminCompanyIds.length === 0) return []

  const managed = await prisma.company.findMany({
    where: {
      isActive: true,
      OR: [
        // ADMIN olduğum firmanın şubeleri. Ek firmanın kendi ADMIN'i, kök admini
        // olmasa da o firmanın şubelerini bu daldan görür.
        { parentCompanyId: { in: adminCompanyIds } },
        // ADMIN olduğum hesabın üyeleri: ek firmalar + onların şubeleri.
        { accountRootId: { in: adminCompanyIds } },
      ],
    },
    select: {
      id: true,
      slug: true,
      name: true,
      branchName: true,
      parentCompanyId: true,
      accountRootId: true,
      isEDonusumEnabled: true,
      disabledModules: true,
      archivedAt: true,
    },
    orderBy: { name: "asc" },
  })

  const visible = managed.filter((c) => !memberCompanyIds.has(c.id))
  if (visible.length === 0) return []

  // Bağlı olunan firmanın adı: şubede ana firma, ek firmada hesap kökü. Ana firma
  // ADMIN listesinde olmayabilir (ek firmanın şubesine kök admini olarak erişildiğinde
  // ana firma o ek firmadır), bu yüzden adlar ayrıca çözülür.
  const relatedIds = new Set<string>()
  for (const c of visible) {
    const relatedId = c.parentCompanyId ?? c.accountRootId
    if (relatedId) relatedIds.add(relatedId)
  }
  const nameById = new Map(
    (
      await prisma.company.findMany({
        where: { id: { in: [...relatedIds] } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name])
  )

  return visible.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    branchName: c.branchName ?? null,
    parentCompanyId: c.parentCompanyId,
    isBranch: c.parentCompanyId != null,
    parentName: nameById.get(c.parentCompanyId ?? c.accountRootId ?? "") ?? null,
    accountRootId: c.accountRootId,
    isEDonusumEnabled: c.isEDonusumEnabled,
    disabledModules: c.disabledModules ?? [],
    archivedAt: c.archivedAt,
  }))
}
