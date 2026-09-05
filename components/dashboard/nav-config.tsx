// Menünün İKON katmanı. Sayfa listesi, roller, gruplar ve yol çözümleme mantığı
// artık `lib/nav/pages.ts`'te yaşıyor — çünkü aynı liste sunucu tarafı yetki
// kapısının da kaynağı ve lucide ikonlarını sunucu bundle'ına taşıyamayız.
//
// Burada yalnızca href -> ikon eşlemesi ve mevcut çağrı noktalarının beklediği
// dışa aktarımlar var. Yeni sayfa eklerken önce lib/nav/pages.ts, sonra buraya
// ikonu yazılır; ikonu unutulan sayfa varsayılan ikonla çizilir (kaybolmaz).

import type { LucideIcon } from "lucide-react"
import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChefHat,
  ClipboardList,
  Coins,
  CreditCard,
  CupSoda,
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
  LayoutGrid,
  LayoutList,
  LayoutTemplate,
  LifeBuoy,
  LineChart,
  ListChecks,
  Package,
  Percent,
  Receipt,
  Scale,
  ScanLine,
  ScrollText,
  ShieldCheck,
  Sticker,
  Store,
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
import { NAV_GROUPS, NAV_PAGES, STANDALONE_NAV_HREFS, type NavPageDef } from "@/lib/nav/pages"

export { navItemActive, moduleKeyForPath } from "@/lib/nav/pages"

export type NavItemDef = NavPageDef & { icon: LucideIcon }

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,

  "/satis/fatura": Receipt,
  "/cari/musteri": Users,
  "/satis/irsaliye": Truck,
  "/satis/siparis": ClipboardList,
  "/satis/hizli": Zap,
  "/satis/fisler": Receipt,
  "/teklif": ScrollText,

  "/alis/fatura": Receipt,
  "/alis/gelen-e-faturalar": Inbox,
  "/cari/tedarikci": UserRound,
  "/alis/irsaliye": Truck,
  "/alis/siparis": ClipboardList,
  "/alis/hizli": Zap,
  "/alis/fisler": Receipt,
  "/alis/fis-tarama": ScanLine,
  "/alis/teklif": ScrollText,

  "/stok/urunler": Package,
  "/stok/hizmetler": Wrench,
  "/depolar": Warehouse,
  "/stok/transfer": ArrowLeftRight,
  "/stok/etiket": Sticker,

  "/restoran/masalar": LayoutGrid,
  "/restoran/masa-listesi": LayoutList,
  "/restoran/adisyonlar": ClipboardList,
  "/restoran/satis": CupSoda,
  "/restoran/menu": ChefHat,
  "/restoran/kontrol-listesi": ListChecks,
  "/restoran/raporlar": BarChart3,

  "/finans/kanallar": Banknote,
  "/finans/hareketler": Wallet,
  "/finans/mutabakat": Scale,
  "/cek-senet/cek": FileCheck,
  "/cek-senet/senet": FileSignature,

  "/raporlar/finansal": LineChart,
  "/raporlar/satis": TrendingUp,
  "/raporlar/alis": TrendingDown,
  "/raporlar/cari": Briefcase,
  "/raporlar/vergi": Percent,
  "/raporlar/nakit-banka": DollarSign,
  "/raporlar/stok": Package,
  "/raporlar/personel": Users,

  "/personel": UsersRound,
  "/personel/maas": DollarSign,
  "/personel/vardiya": CalendarClock,
  "/personel/puantaj": ClipboardList,
  "/personel/izin": CalendarCheck,
  "/personel/zimmet": BadgeCheck,
  "/personel/ik": FolderOpen,

  "/ayarlar/e-donusum": FileText,
  "/e-donusum/kontor": Coins,
  "/e-donusum/seri-no": Hash,
  "/e-donusum/sablon": LayoutTemplate,

  "/ayarlar/firma": Building2,
  "/ayarlar/fis-tasarim": Receipt,
  "/ayarlar/tanimlar": Tags,
  "/ayarlar/ekip": UserCog,
  "/ayarlar/roller": ShieldCheck,
  "/ayarlar/sube-mudurleri": UserCog,
  "/ayarlar/abonelik": CreditCard,
  "/ayarlar/subeler": GitBranch,
  "/ayarlar/veri-aktarim": Database,
  "/ayarlar/sube-bilgileri": Store,

  "/ayarlar/destek": LifeBuoy,
  "/ayarlar/profil": UserCog,
}

export const allNavItems: NavItemDef[] = NAV_PAGES.map((page) => ({
  ...page,
  icon: ICONS[page.href] ?? FileText,
}))

export const navGroups = NAV_GROUPS
export const standaloneNavHrefs = STANDALONE_NAV_HREFS
