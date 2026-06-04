import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  Database,
  DollarSign,
  FileCheck,
  FileSignature,
  FileText,
  FolderOpen,
  GitBranch,
  Hash,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  Package,
  Percent,
  Receipt,
  Scale,
  ScrollText,
  Tags,
  TrendingDown,
  TrendingUp,
  Truck,
  UserCog,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  Warehouse,
  Wrench,
  Zap,
} from "lucide-react"

export type NavItemDef = {
  href: string
  label: string
  icon: LucideIcon
  roles: string[]
}

const ALL_ROLES = ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"]

export const allNavItems: NavItemDef[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ALL_ROLES,
  },

  // Satış
  { href: "/satis/fatura", label: "Satış Faturası", icon: Receipt, roles: ["ADMIN", "ACCOUNTANT", "SALES"] },
  { href: "/cari/musteri", label: "Müşteri", icon: Users, roles: ["ADMIN", "ACCOUNTANT", "SALES"] },
  { href: "/satis/irsaliye", label: "Satış İrsaliyesi", icon: Truck, roles: ["ADMIN", "ACCOUNTANT", "SALES", "STOCK"] },
  { href: "/satis/siparis", label: "Satış Siparişi", icon: ClipboardList, roles: ["ADMIN", "ACCOUNTANT", "SALES"] },
  { href: "/satis/hizli", label: "Hızlı Satış", icon: Zap, roles: ["ADMIN", "ACCOUNTANT", "SALES"] },
  { href: "/teklif", label: "Teklif", icon: ScrollText, roles: ["ADMIN", "ACCOUNTANT", "SALES"] },

  // Alış
  { href: "/alis/fatura", label: "Alış Faturası", icon: Receipt, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/alis/gelen-e-faturalar", label: "Gelen E-Faturalar", icon: Inbox, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/cari/tedarikci", label: "Tedarikçi", icon: UserRound, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/alis/irsaliye", label: "Alış İrsaliyesi", icon: Truck, roles: ["ADMIN", "ACCOUNTANT", "STOCK"] },
  { href: "/alis/siparis", label: "Alış Siparişi", icon: ClipboardList, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/alis/hizli", label: "Hızlı Alış Fişi", icon: Zap, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/alis/teklif", label: "Satın Alma Teklifi", icon: ScrollText, roles: ["ADMIN", "ACCOUNTANT"] },

  // Stok
  { href: "/stok/urunler", label: "Ürün Listesi", icon: Package, roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/stok/hizmetler", label: "Hizmet Listesi", icon: Wrench, roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/depolar", label: "Depo Listesi", icon: Warehouse, roles: ["ADMIN", "STOCK"] },
  { href: "/stok/transfer", label: "Stok Transfer", icon: ArrowLeftRight, roles: ["ADMIN", "STOCK"] },

  // Finans
  { href: "/finans/kanallar", label: "Finans Kanalları", icon: Banknote, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/finans/hareketler", label: "Finans Hareketleri", icon: Wallet, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/finans/mutabakat", label: "Mutabakat", icon: Scale, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/cek-senet/cek", label: "Çek Portföyü", icon: FileCheck, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/cek-senet/senet", label: "Senet Portföyü", icon: FileSignature, roles: ["ADMIN", "ACCOUNTANT"] },

  // Raporlar
  { href: "/raporlar/satis", label: "Satış Raporları", icon: TrendingUp, roles: ["ADMIN", "ACCOUNTANT", "SALES", "VIEWER"] },
  { href: "/raporlar/alis", label: "Alış Raporları", icon: TrendingDown, roles: ["ADMIN", "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/cari", label: "Cari Raporlar", icon: Briefcase, roles: ["ADMIN", "ACCOUNTANT", "SALES", "VIEWER"] },
  { href: "/raporlar/vergi", label: "Vergi Raporları", icon: Percent, roles: ["ADMIN", "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/nakit-banka", label: "Nakit & Banka", icon: DollarSign, roles: ["ADMIN", "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/stok", label: "Stok Raporları", icon: Package, roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"] },
  { href: "/raporlar/personel", label: "Personel Raporları", icon: Users, roles: ["ADMIN", "ACCOUNTANT", "VIEWER"] },

  // Personel
  { href: "/personel", label: "Personeller", icon: UsersRound, roles: ["ADMIN"] },
  { href: "/personel/maas", label: "Maaş-Ödemeler", icon: DollarSign, roles: ["ADMIN"] },
  { href: "/personel/izin", label: "İzin-Devam", icon: CalendarCheck, roles: ["ADMIN"] },
  { href: "/personel/zimmet", label: "Zimmet", icon: BadgeCheck, roles: ["ADMIN"] },
  { href: "/personel/ik", label: "İnsan Kaynakları", icon: FolderOpen, roles: ["ADMIN"] },

  // E-Dönüşüm
  { href: "/ayarlar/e-donusum", label: "E-Dönüşüm Ayarları", icon: FileText, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/e-donusum/seri-no", label: "Seri No Tanımları", icon: Hash, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/e-donusum/sablon", label: "Belge Şablonları", icon: LayoutTemplate, roles: ["ADMIN", "ACCOUNTANT"] },

  // Ayarlar
  { href: "/ayarlar/firma", label: "Firma Bilgileri", icon: Building2, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/ayarlar/tanimlar", label: "Tanımlar", icon: Tags, roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/ayarlar/ekip", label: "Kullanıcı Yönetimi", icon: UserCog, roles: ["ADMIN"] },
  { href: "/ayarlar/abonelik", label: "Abonelik", icon: CreditCard, roles: ["ADMIN"] },
  { href: "/ayarlar/veri-aktarim", label: "Veri Aktarım", icon: Database, roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/ayarlar/subeler", label: "Şube Yönetimi", icon: GitBranch, roles: ["ADMIN"] },

  // Standalone (sidebar bottom)
  { href: "/ayarlar/destek", label: "Destek", icon: LifeBuoy, roles: ALL_ROLES },
  { href: "/ayarlar/profil", label: "Profil", icon: UserCog, roles: ALL_ROLES },
]

export const navGroups: Array<{ title: string; hrefs: string[] }> = [
  {
    title: "Satış",
    hrefs: [
      "/satis/fatura",
      "/cari/musteri",
      "/satis/irsaliye",
      "/satis/siparis",
      "/satis/hizli",
      "/teklif",
    ],
  },
  {
    title: "Alış",
    hrefs: [
      "/alis/fatura",
      "/alis/gelen-e-faturalar",
      "/cari/tedarikci",
      "/alis/irsaliye",
      "/alis/siparis",
      "/alis/hizli",
      "/alis/teklif",
    ],
  },
  {
    title: "Stok",
    hrefs: ["/stok/urunler", "/stok/hizmetler", "/depolar", "/stok/transfer"],
  },
  {
    title: "Finans",
    hrefs: [
      "/finans/kanallar",
      "/finans/hareketler",
      "/finans/mutabakat",
      "/cek-senet/cek",
      "/cek-senet/senet",
    ],
  },
  {
    title: "Raporlar",
    hrefs: [
      "/raporlar/satis",
      "/raporlar/alis",
      "/raporlar/cari",
      "/raporlar/vergi",
      "/raporlar/nakit-banka",
      "/raporlar/stok",
      "/raporlar/personel",
    ],
  },
  {
    title: "Personel",
    hrefs: [
      "/personel",
      "/personel/maas",
      "/personel/izin",
      "/personel/zimmet",
      "/personel/ik",
    ],
  },
  {
    title: "E-Dönüşüm",
    hrefs: ["/ayarlar/e-donusum", "/e-donusum/seri-no", "/e-donusum/sablon"],
  },
  {
    title: "Ayarlar",
    hrefs: [
      "/ayarlar/firma",
      "/ayarlar/tanimlar",
      "/ayarlar/ekip",
      "/ayarlar/abonelik",
      "/ayarlar/veri-aktarim",
      "/ayarlar/subeler",
    ],
  },
]

/** Items rendered as direct links below the collapsible groups in the sidebar. */
export const standaloneNavHrefs: string[] = ["/ayarlar/destek", "/ayarlar/profil"]

export function navItemActive(pathname: string, href: string) {
  if (pathname === href) return true
  if (href === "/dashboard") return false
  // Avoid /personel matching /personel/maas etc. for the parent — only match exact or sub-path
  return pathname === href || pathname.startsWith(href + "/")
}
