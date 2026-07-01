import { Role } from "@prisma/client"
import { getUserContext } from "@/lib/auth/user-context"

// Modül bazlı erişim izinleri
export const modulePermissions: Record<string, Role[]> = {
  // Cari modülü
  "/cari": [Role.ADMIN, Role.ACCOUNTANT, Role.SALES],
  "/api/cari": [Role.ADMIN, Role.ACCOUNTANT, Role.SALES],
  
  // Stok modülü
  "/stok": [Role.ADMIN, Role.STOCK, Role.SALES],
  "/api/stok": [Role.ADMIN, Role.STOCK, Role.SALES],
  
  // E-Fatura modülü
  "/e-donusum": [Role.ADMIN, Role.ACCOUNTANT, Role.SALES],
  "/api/e-donusum": [Role.ADMIN, Role.ACCOUNTANT, Role.SALES],
  
  // Finans modülü
  "/finans": [Role.ADMIN, Role.ACCOUNTANT],
  "/api/finans": [Role.ADMIN, Role.ACCOUNTANT],
  
  // Raporlar modülü - herkes görebilir
  "/raporlar": [Role.ADMIN, Role.ACCOUNTANT, Role.STOCK, Role.SALES, Role.VIEWER],
  "/api/raporlar": [Role.ADMIN, Role.ACCOUNTANT, Role.STOCK, Role.SALES, Role.VIEWER],
  
  // Firma ayarları - sadece admin
  "/companies": [Role.ADMIN],
  "/api/companies": [Role.ADMIN],
}

// Yazma işlemleri için izinler (POST, PUT, DELETE)
export const writePermissions: Record<string, Role[]> = {
  "/cari": [Role.ADMIN, Role.ACCOUNTANT, Role.SALES],
  "/stok": [Role.ADMIN, Role.STOCK],
  "/e-donusum": [Role.ADMIN, Role.ACCOUNTANT],
  "/finans": [Role.ADMIN, Role.ACCOUNTANT],
  "/companies": [Role.ADMIN],
}

export interface UserRole {
  companyId: string
  companyName: string
  role: Role
  isActive: boolean
}

export interface AuthContext {
  userId: string
  email: string
  name: string | null
  isSuperAdmin: boolean
  companies: UserRole[]
  activeCompany: UserRole | null
}

// Kullanıcı yetki bilgilerini al
export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getUserContext()
  if (!user) {
    return null
  }

  const companies: UserRole[] = user.companies.map((company) => ({
    companyId: company.companyId,
    companyName: company.companyName,
    role: company.role,
    isActive: company.isActive,
  }))

  // Aktif firma (ilk aktif firma veya ilk firma)
  const activeCompany = companies.find(c => c.isActive) || companies[0] || null

  return {
    userId: user.userId,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    companies,
    activeCompany
  }
}

/**
 * Seçili firma/şubeyi çözer. Dashboard gibi server sayfaları companyId'yi buradan
 * almalıdır: kullanıcının seçimi URL'de `?company=<id>` ile taşınır (bkz.
 * dashboard-company-provider). İstenen firma kullanıcının erişebildiği AKTİF bir
 * firma/şube ise o kullanılır; aksi halde varsayılan aktif firmaya düşülür.
 *
 * `activeCompany` tek başına HER ZAMAN listedeki ilk firmayı (ana firmayı) verdiği
 * için, bu olmadan alt şubede ana firmanın verileri gösterilir.
 */
export function resolveActiveCompany(
  context: AuthContext,
  requestedCompanyId?: string | null,
): UserRole | null {
  if (requestedCompanyId) {
    const match = context.companies.find(
      (c) => c.companyId === requestedCompanyId && c.isActive,
    )
    if (match) return match
  }
  return context.activeCompany
}

// Modül erişim kontrolü
export function canAccessModule(role: Role, modulePath: string): boolean {
  // Tam eşleşme kontrolü
  const allowedRoles = modulePermissions[modulePath]
  if (allowedRoles) {
    return allowedRoles.includes(role)
  }

  // Prefix kontrolü
  for (const [path, roles] of Object.entries(modulePermissions)) {
    if (modulePath.startsWith(path)) {
      return roles.includes(role)
    }
  }

  // Varsayılan: sadece ADMIN erişebilir
  return role === Role.ADMIN
}

// Yazma izni kontrolü
export function canWrite(role: Role, modulePath: string): boolean {
  // Tam eşleşme kontrolü
  const allowedRoles = writePermissions[modulePath]
  if (allowedRoles) {
    return allowedRoles.includes(role)
  }

  // Prefix kontrolü
  for (const [path, roles] of Object.entries(writePermissions)) {
    if (modulePath.startsWith(path)) {
      return roles.includes(role)
    }
  }

  // Varsayılan: sadece ADMIN yazabilir
  return role === Role.ADMIN
}

// Rol etiketleri
export const roleLabels: Record<Role, string> = {
  ADMIN: "Yönetici",
  BRANCH_MANAGER: "Şube Müdürü",
  ACCOUNTANT: "Muhasebeci",
  STOCK: "Stokçu",
  SALES: "Satış",
  VIEWER: "Görüntüleyici",
}

// Rol renkleri
export const roleColors: Record<Role, string> = {
  ADMIN: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  BRANCH_MANAGER: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  ACCOUNTANT: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  STOCK: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  SALES: "bg-green-500/20 text-green-400 border-green-500/30",
  VIEWER: "bg-slate-500/20 text-slate-400 border-slate-500/30",
}

// Dashboard yönlendirmesi
export function getDashboardPath(role: Role): string {
  switch (role) {
    case Role.ADMIN:
    case Role.BRANCH_MANAGER:
      return "/dashboard/admin"
    case Role.ACCOUNTANT:
      return "/dashboard/accountant"
    case Role.STOCK:
      return "/dashboard/stock"
    case Role.SALES:
      return "/dashboard/sales"
    case Role.VIEWER:
      return "/dashboard/viewer"
    default:
      return "/dashboard/viewer"
  }
}

