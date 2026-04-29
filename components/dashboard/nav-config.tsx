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
  Database,
  Truck,
  Settings2,
  UserCog,
  UsersRound,
  CreditCard,
  LifeBuoy,
  Tags,
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
    href: "/raporlar/satis-alis",
    label: "Satışlar - Alışlar",
    icon: Receipt,
    roles: ["ADMIN", "ACCOUNTANT", "SALES", "VIEWER"],
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
    href: "/raporlar/finansal",
    label: "Finansal Raporlar",
    icon: BarChart3,
    roles: ["ADMIN", "ACCOUNTANT", "VIEWER"],
  },
  {
    href: "/raporlar/stok",
    label: "Stok Raporları",
    icon: Package,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"],
  },
  {
    href: "/raporlar",
    label: "Raporlar Ana Sayfa",
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
  {
    href: "/ayarlar/firma",
    label: "Firma Ayarları",
    icon: Settings2,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/ayarlar/e-donusum",
    label: "E-Dönüşüm Ayarları",
    icon: FileText,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/ayarlar/profil",
    label: "Profilim",
    icon: UserCog,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"],
  },
  {
    href: "/ayarlar/ekip",
    label: "Ekip Yönetimi",
    icon: UsersRound,
    roles: ["ADMIN"],
  },
  {
    href: "/ayarlar/tanimlar",
    label: "Tanımlar",
    icon: Tags,
    roles: ["ADMIN", "ACCOUNTANT"],
  },
  {
    href: "/ayarlar/abonelik",
    label: "Abonelik",
    icon: CreditCard,
    roles: ["ADMIN"],
  },
  {
    href: "/ayarlar/destek",
    label: "Destek",
    icon: LifeBuoy,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"],
  },
]

export const navGroups = [
  { title: "Satış", hrefs: ["/teklif", "/faturalar", "/cari"] },
  { title: "Alış", hrefs: ["/e-donusum", "/e-irsaliye"] },
  { title: "Stok", hrefs: ["/stok", "/depolar"] },
  { title: "Finans", hrefs: ["/finans", "/finans/hareketler", "/cek-senet"] },
  {
    title: "Raporlar",
    hrefs: [
      "/raporlar/satis-alis",
      "/raporlar/finansal",
      "/raporlar/stok",
      "/raporlar",
    ],
  },
  {
    title: "Ayarlar",
    hrefs: [
      "/ayarlar/firma",
      "/ayarlar/e-donusum",
      "/ayarlar/profil",
      "/ayarlar/ekip",
      "/ayarlar/tanimlar",
      "/ayarlar/veri-aktarim",
      "/ayarlar/abonelik",
      "/ayarlar/destek",
    ],
  },
]

export function navItemActive(pathname: string, href: string) {
  return (
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href)) ||
    (href === "/muhasebe/yevmiye" && pathname.startsWith("/muhasebe"))
  )
}
