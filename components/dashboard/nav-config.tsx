import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  Users,
  Package,
  Wallet,
  FileText,
  BarChart3,
  Receipt,
  FileCheck,
  ScrollText,
  Warehouse,
  BookOpen,
  Database,
  Truck,
} from "lucide-react"

export type NavItemDef = {
  href: string
  label: string
  icon: LucideIcon
  roles: string[]
}

export const allNavItems: NavItemDef[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"],
  },
  {
    href: "/cari",
    label: "Cari Hesaplar",
    icon: Users,
    roles: ["ADMIN", "ACCOUNTANT", "SALES"],
  },
  {
    href: "/stok",
    label: "Stok",
    icon: Package,
    roles: ["ADMIN", "STOCK", "SALES"],
  },
  {
    href: "/finans",
    label: "Finans",
    icon: Wallet,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/e-donusum",
    label: "E-Dönüşüm",
    icon: FileText,
    roles: ["ADMIN", "ACCOUNTANT", "SALES"],
  },
  {
    href: "/e-irsaliye",
    label: "E-İrsaliye",
    icon: Truck,
    roles: ["ADMIN", "ACCOUNTANT", "SALES", "STOCK"],
  },
  {
    href: "/faturalar",
    label: "Faturalar",
    icon: Receipt,
    roles: ["ADMIN", "ACCOUNTANT", "SALES"],
  },
  {
    href: "/teklif",
    label: "Teklifler",
    icon: ScrollText,
    roles: ["ADMIN", "ACCOUNTANT", "SALES"],
  },
  {
    href: "/cek-senet",
    label: "Çek/Senet",
    icon: FileCheck,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/depolar",
    label: "Depolar",
    icon: Warehouse,
    roles: ["ADMIN", "STOCK"],
  },
  {
    href: "/muhasebe/yevmiye",
    label: "Muhasebe",
    icon: BookOpen,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/raporlar",
    label: "Raporlar",
    icon: BarChart3,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"],
  },
  {
    href: "/finans/hareketler",
    label: "Finans Hareketleri",
    icon: Wallet,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/ayarlar/veri-aktarim",
    label: "Veri Aktarım",
    icon: Database,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES"],
  },
]

export const navGroups = [
  { title: "Satış", hrefs: ["/teklif", "/faturalar", "/cari"] },
  { title: "Alış", hrefs: ["/e-donusum", "/e-irsaliye"] },
  { title: "Stok", hrefs: ["/stok", "/depolar"] },
  { title: "Finans", hrefs: ["/finans", "/finans/hareketler", "/cek-senet"] },
  { title: "Raporlama", hrefs: ["/raporlar", "/muhasebe/yevmiye"] },
  { title: "Ayarlar", hrefs: ["/ayarlar/veri-aktarim"] },
]

export function navItemActive(pathname: string, href: string) {
  return (
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href)) ||
    (href === "/muhasebe/yevmiye" && pathname.startsWith("/muhasebe"))
  )
}
