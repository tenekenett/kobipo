import type { Role } from "@prisma/client"

/**
 * Rol enum değerlerinin Türkçe görünen etiketleri. Tek kaynak — UI'da ham enum
 * (ör. "BRANCH_MANAGER") göstermek yerine her yerde buradan oku. Yeni rol
 * eklenince Record<Role,…> derleme hatası vererek burayı güncellemeye zorlar.
 */
export const roleLabels: Record<Role, string> = {
  ADMIN: "Yönetici",
  BRANCH_MANAGER: "Şube Müdürü",
  ACCOUNTANT: "Muhasebeci",
  STOCK: "Stokçu",
  SALES: "Satış",
  VIEWER: "Görüntüleyici",
  // Gerçek ad firmanın tanımladığı rolde (CompanyRole.name). Bu etiket yalnız özel
  // rol çözülemediğinde (ör. rol silinmiş) görünür.
  CUSTOM: "Özel rol",
}

/** Rolü (enum veya string) Türkçe etikete çevirir; bilinmeyen değer olduğu gibi döner. */
export function roleLabel(role: Role | string | null | undefined): string {
  if (!role) return "—"
  return roleLabels[role as Role] ?? String(role)
}
