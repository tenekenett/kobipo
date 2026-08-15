import { cache } from "react"
import { Role } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { getSession } from "@/lib/auth/session"
import { getManagedCompanies } from "@/lib/auth/branch-access"

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
  /** Alt şube mi (aynı VKN, `parentCompanyId` dolu)? Ek firmada FALSE'tur. */
  isBranch?: boolean
  parentCompanyId?: string | null
  /** Bağlı olunan firmanın adı: şubede ana firma, ek firmada hesap kökü. */
  parentName?: string | null
  /** Hesap (faturalama) kökü — dolu ve şube değilse bu bir EK FİRMA'dır. */
  accountRootId?: string | null
  /** Üyelik DEĞİL; ana firmanın/hesap kökünün ADMIN'i olunduğu için erişilen firma. */
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
        accountRootId: string | null
        parentCompanyId: string | null
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
                accountRootId: true,
                parentCompanyId: true,
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
    // Ek firmayı (hesaba bağlı ayrı tüzel kişi) üyelik üzerinden görenler de rozeti
    // görsün — yönetici erişimiyle gelen kayıtla aynı bilgi.
    accountRootId: entry.company.accountRootId,
    // Ham gerçek: şube mi? `isBranch` BİLİNÇLİ olarak set edilmez — o bayrak "üyeliksiz,
    // parent-admin erişimiyle görülen şube" anlamı taşıyor ve firma seçici ile şube
    // bağlam şeridi ona bakıyor; doğrudan üye olunan şubenin bugünkü davranışı
    // değişmemeli. Etiketleme (Şube/Ek firma rozeti) bu alandan çözülür.
    parentCompanyId: entry.company.parentCompanyId,
  }))

  // Rozetteki hesap kökü adı: kullanıcının KENDİ listesinden çözülebiliyorsa doldurulur.
  // Ek sorgu yok; ek firmayı hesabın yöneticisi açtığı için kök pratikte listededir,
  // çözülemezse rozet adsız çizilir (bilgi eksikliği hataya dönüşmez).
  const nameByCompanyId = new Map(user.companies.map((e) => [e.company.id, e.company.name]))
  for (const company of membershipCompanies) {
    if (company.accountRootId && !company.parentName) {
      company.parentName = nameByCompanyId.get(company.accountRootId) ?? null
    }
  }

  // Yönetici erişimi: ADMIN olunan firmaların alt şubelerini VE hesaba bağlı ek
  // firmaları SANAL ADMIN (üyelik değil) olarak listenin SONUNA ekle — üyelikler önce
  // kaldığı için varsayılan firma seçimi bozulmaz. Hata olsa da çekirdek üyelik bağlamı
  // korunur. Ek firma `isBranch: false` gelir: ayrı bir tüzel kişidir, firma seçicide
  // normal firma gibi görünür ve şube bağlam şeridi çizilmez.
  let managedCompanies: UserCompanyContext[] = []
  try {
    const managed = await getManagedCompanies(user.id)
    managedCompanies = managed.map((c) => ({
      companyId: c.id,
      companySlug: c.slug,
      companyName: c.name,
      companyBranchName: c.branchName,
      role: Role.ADMIN,
      isActive: true,
      isEDonusumEnabled: c.isEDonusumEnabled,
      disabledModules: c.disabledModules,
      // Erişim ana firmanın/hesap kökünün ADMIN'liğinden doğar, üyelik satırı yoktur —
      // dolayısıyla tutunacak bir izin kaydı da yok: bu bağlam her zaman kısıtsız.
      allowedPaths: [],
      writablePaths: [],
      customRoleId: null,
      customRoleName: null,
      createdAt: new Date(0),
      isBranch: c.isBranch,
      parentCompanyId: c.parentCompanyId,
      parentName: c.parentName,
      accountRootId: c.accountRootId,
      viaParent: true,
    }))
  } catch (error) {
    console.error("getUserContext managed companies error:", error)
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    isBlogEditor: user.isBlogEditor,
    companies: [...membershipCompanies, ...managedCompanies],
  }
})
