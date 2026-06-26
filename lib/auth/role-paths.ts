import type { Role } from "@prisma/client"

export function roleToDashboardPath(role: Role | string | null | undefined): string {
  switch (role) {
    case "ADMIN":
    case "BRANCH_MANAGER":
      return "/dashboard/admin"
    case "ACCOUNTANT":
      return "/dashboard/accountant"
    case "STOCK":
      return "/dashboard/stock"
    case "SALES":
      return "/dashboard/sales"
    case "VIEWER":
      return "/dashboard/viewer"
    default:
      return "/dashboard/viewer"
  }
}
