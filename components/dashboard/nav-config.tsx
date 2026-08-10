import type { LucideIcon } from "lucide-react"
import { MODULE_GROUP_TO_KEY } from "@/lib/modules"
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
  ListChecks,
  Package,
  Percent,
  Receipt,
  Scale,
  ScrollText,
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

export type NavItemDef = {
  href: string
  label: string
  icon: LucideIcon
  roles: string[]
  /**
   * Öğeyi grubundan BAĞIMSIZ olarak bu modüle bağlar. Verilmezse bugünkü davranış
   * geçerlidir: öğe grubunun modülünü miras alır.
   *
   * Örn. "Reçeteler" sayfası Stok grubunda yaşar (reçete stok kavramıdır) ama
   * yalnızca Restoran & Kafe paketi olanlara görünür.
   */
  module?: string
}

const ALL_ROLES = ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"]

// Şube müdürü, şubede operasyonel olarak ADMIN ile aynı yetkilere sahiptir; yalnızca
// hesap/yönetim düzeyindeki şu öğeler KISITLIDIR (BRANCH_MANAGER eklenmez):
// Kullanıcı Yönetimi (/ayarlar/ekip), Şube Yönetimi (/ayarlar/subeler),
// Abonelik (/ayarlar/abonelik) ve Şube Müdürleri (/ayarlar/sube-mudurleri).
const BM = "BRANCH_MANAGER"

export const allNavItems: NavItemDef[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ALL_ROLES,
  },

  // Satış
  { href: "/satis/fatura", label: "Satış Faturası", icon: Receipt, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/cari/musteri", label: "Müşteri", icon: Users, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/satis/irsaliye", label: "Satış İrsaliyesi", icon: Truck, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES", "STOCK"] },
  { href: "/satis/siparis", label: "Satış Siparişi", icon: ClipboardList, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/satis/hizli", label: "Hızlı Satış", icon: Zap, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/satis/fisler", label: "Satış Fişleri", icon: Receipt, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/teklif", label: "Teklif", icon: ScrollText, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },

  // Alış
  { href: "/alis/fatura", label: "Alış Faturası", icon: Receipt, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/gelen-e-faturalar", label: "Gelen E-Faturalar", icon: Inbox, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/cari/tedarikci", label: "Tedarikçi", icon: UserRound, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/irsaliye", label: "Alış İrsaliyesi", icon: Truck, roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK"] },
  { href: "/alis/siparis", label: "Alış Siparişi", icon: ClipboardList, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/hizli", label: "Hızlı Alış", icon: Zap, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/fisler", label: "Alış Fişleri", icon: Receipt, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/teklif", label: "Satın Alma Teklifi", icon: ScrollText, roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Stok
  { href: "/stok/urunler", label: "Ürün Listesi", icon: Package, roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/stok/hizmetler", label: "Hizmet Listesi", icon: Wrench, roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/depolar", label: "Depo Listesi", icon: Warehouse, roles: ["ADMIN", BM, "STOCK"] },
  { href: "/stok/transfer", label: "Stok Transfer", icon: ArrowLeftRight, roles: ["ADMIN", BM, "STOCK"] },
  { href: "/stok/etiket", label: "Etiket Tasarımı", icon: Sticker, roles: ["ADMIN", BM, "STOCK", "SALES"] },

  // Restoran & Kafe — kurulum (menü/reçete), kullanım (satış) ve ölçüm (raporlar)
  // aynı grupta. Reçete ekranı eskiden Stok grubundaydı; kafeci menüyü kurmak
  // için iki grup arasında gidip geliyordu. Reçete MANTIĞI hâlâ lib/stock'ta —
  // taşınan yalnızca ekranın adresi (bkz. docs/restoran/SADELESTIRME.md "İş 3").
  { href: "/restoran/masalar", label: "Masalar", icon: LayoutGrid, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  // Aynı masaların LİSTE hâli: kroki masanın yerini anlatır, servis sırasında
  // yalnız adı lazım. Dokunmatik kasada hedefler büyük ve sabit kalsın diye ayrı
  // ekran — davranış krokiyle ortak (lib/restoran/use-table-opener.ts).
  { href: "/restoran/masa-listesi", label: "Masa Listesi", icon: LayoutList, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  // Salon planı masaya bakar; bu liste hesaba. Masasız (paket/gel-al) adisyonun
  // açılabildiği ve görülebildiği tek yer burası — ayrıca kapanmış adisyonun
  // gün bazında görülebildiği tek yer (gün sonu raporu fişleri sayar).
  { href: "/restoran/adisyonlar", label: "Adisyonlar", icon: ClipboardList, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/restoran/satis", label: "Kahveci Satış", icon: CupSoda, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/restoran/menu", label: "Menü & Reçeteler", icon: ChefHat, roles: ["ADMIN", BM, "STOCK", "ACCOUNTANT"] },
  // Açılış/kapanış listesini KURAN ve uyumu ÖLÇEN ekran → patron/müdür. Personel
  // maddeleri buradan değil, satış ekranındaki uyarı şeridinden onaylar; o yüzden
  // SALES bu sayfayı görmez ama tik atmaya devam eder.
  { href: "/restoran/kontrol-listesi", label: "Kontrol Listesi", icon: ListChecks, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/restoran/raporlar", label: "Raporlar", icon: BarChart3, roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Finans
  { href: "/finans/kanallar", label: "Finans Kanalları", icon: Banknote, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/finans/hareketler", label: "Finans Hareketleri", icon: Wallet, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/finans/mutabakat", label: "Mutabakat", icon: Scale, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/cek-senet/cek", label: "Çek Portföyü", icon: FileCheck, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/cek-senet/senet", label: "Senet Portföyü", icon: FileSignature, roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Raporlar
  { href: "/raporlar/satis", label: "Satış Raporları", icon: TrendingUp, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES", "VIEWER"] },
  { href: "/raporlar/alis", label: "Alış Raporları", icon: TrendingDown, roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/cari", label: "Cari Raporlar", icon: Briefcase, roles: ["ADMIN", BM, "ACCOUNTANT", "SALES", "VIEWER"] },
  { href: "/raporlar/vergi", label: "Vergi Raporları", icon: Percent, roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/nakit-banka", label: "Nakit & Banka", icon: DollarSign, roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/stok", label: "Stok Raporları", icon: Package, roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES", "VIEWER"] },
  { href: "/raporlar/personel", label: "Personel Raporları", icon: Users, roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },

  // Personel
  { href: "/personel", label: "Personeller", icon: UsersRound, roles: ["ADMIN", BM] },
  { href: "/personel/maas", label: "Maaş-Ödemeler", icon: DollarSign, roles: ["ADMIN", BM] },
  { href: "/personel/vardiya", label: "Vardiya Takvimi", icon: CalendarClock, roles: ["ADMIN", BM] },
  { href: "/personel/puantaj", label: "Aylık Puantaj", icon: ClipboardList, roles: ["ADMIN", BM] },
  { href: "/personel/izin", label: "İzin-Devam", icon: CalendarCheck, roles: ["ADMIN", BM] },
  { href: "/personel/zimmet", label: "Zimmet", icon: BadgeCheck, roles: ["ADMIN", BM] },
  { href: "/personel/ik", label: "İnsan Kaynakları", icon: FolderOpen, roles: ["ADMIN", BM] },

  // E-Dönüşüm
  { href: "/ayarlar/e-donusum", label: "E-Dönüşüm Ayarları", icon: FileText, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/e-donusum/kontor", label: "Kontör", icon: Coins, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/e-donusum/seri-no", label: "Seri No Tanımları", icon: Hash, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/e-donusum/sablon", label: "Belge Şablonları", icon: LayoutTemplate, roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Ayarlar
  { href: "/ayarlar/firma", label: "Firma Bilgileri", icon: Building2, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/ayarlar/fis-tasarim", label: "Fiş Tasarımı", icon: Receipt, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/ayarlar/tanimlar", label: "Tanımlar", icon: Tags, roles: ["ADMIN", BM, "ACCOUNTANT"] },
  // KISITLI: yalnız ADMIN
  { href: "/ayarlar/ekip", label: "Kullanıcı Yönetimi", icon: UserCog, roles: ["ADMIN"] },
  { href: "/ayarlar/sube-mudurleri", label: "Şube Müdürleri", icon: UserCog, roles: ["ADMIN"] },
  { href: "/ayarlar/abonelik", label: "Abonelik", icon: CreditCard, roles: ["ADMIN"] },
  { href: "/ayarlar/subeler", label: "Şube Yönetimi", icon: GitBranch, roles: ["ADMIN"] },
  { href: "/ayarlar/veri-aktarim", label: "Veri Aktarım", icon: Database, roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/ayarlar/sube-bilgileri", label: "Şube Bilgileri", icon: Store, roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Standalone (sidebar bottom)
  { href: "/ayarlar/destek", label: "Destek", icon: LifeBuoy, roles: ALL_ROLES },
  { href: "/ayarlar/profil", label: "Profil", icon: UserCog, roles: ALL_ROLES },
]

/**
 * Kenar çubuğundaki grupların İÇERİĞİ. Sıra buradaki sıradır.
 *
 * DİKKAT — yeni bir sayfa İKİ yere birden eklenir: yukarıdaki `allNavItems`
 * (etiket + ikon + rol) ve buradaki grup `hrefs` listesi. Yalnız `allNavItems`'a
 * eklenen öğe hiçbir grupta yer almadığı için kenar çubuğunda GÖRÜNMEZ — sayfa
 * çalışır, adresine gidilebilir, ama menüden ulaşılamaz.
 */
export const navGroups: Array<{ title: string; hrefs: string[] }> = [
  {
    title: "Satış",
    hrefs: [
      "/satis/fatura",
      "/cari/musteri",
      "/satis/irsaliye",
      "/satis/siparis",
      "/satis/hizli",
      "/satis/fisler",
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
      "/alis/fisler",
      "/alis/teklif",
    ],
  },
  {
    title: "Stok",
    hrefs: [
      "/stok/urunler",
      "/stok/hizmetler",
      "/depolar",
      "/stok/transfer",
      "/stok/etiket",
    ],
  },
  {
    title: "Restoran & Kafe",
    // "/restoran/adisyon" menüde YOK (masadan girilir) ama modül kapısında olmalı:
    // adres çubuğuna elle yazılan adisyon linki de `restaurant` kapalıyken kilitlensin.
    hrefs: [
      "/restoran/masalar",
      "/restoran/masa-listesi",
      "/restoran/adisyonlar",
      "/restoran/adisyon",
      "/restoran/satis",
      "/restoran/menu",
      "/restoran/kontrol-listesi",
      "/restoran/raporlar",
    ],
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
      "/personel/vardiya",
      "/personel/puantaj",
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
      "/ayarlar/fis-tasarim",
      "/ayarlar/tanimlar",
      "/ayarlar/ekip",
      "/ayarlar/sube-mudurleri",
      "/ayarlar/abonelik",
      "/ayarlar/veri-aktarim",
      "/ayarlar/subeler",
      "/ayarlar/sube-bilgileri",
    ],
  },
]

/** Items rendered as direct links below the collapsible groups in the sidebar. */
export const standaloneNavHrefs: string[] = ["/e-donusum/kontor", "/ayarlar/destek", "/ayarlar/profil"]

/**
 * Bazı nav öğeleri tıklanınca farklı bir landing path'e yönlendirir
 * (server-side redirect). Bu durumda gerçek pathname nav href ile
 * eşleşmediği için ilgili öğe aktif sayılmaz ve menü grubu kapanır.
 * Aşağıdaki eşleme "landing path -> nav href(ler)" ile bu öğeleri de
 * aktif kabul ederek dropdown'ın açık kalmasını sağlar.
 */
const NAV_HREF_REDIRECT_ALIASES: Record<string, string[]> = {
  "/stok": ["/stok/urunler"],
  "/depolar/transfer": ["/stok/transfer"],
  "/banka/mutabakat": ["/finans/mutabakat"],
  "/raporlar/nakit-akisi": ["/raporlar/nakit-banka"],
  "/raporlar/cari-yaslandirma": ["/raporlar/cari"],
  "/raporlar/vergiler": ["/raporlar/vergi"],
}

/**
 * Cari (müşteri/tedarikçi) sayfaları aynı `/cari` ağacı altında paylaşılır.
 * Hangi nav öğesinin (Müşteri mi Tedarikçi mi) aktif olacağını yol segmentine
 * (`/cari/customers/*` vs `/cari/suppliers/*`) veya liste sayfasındaki `?tab=`
 * değerine göre belirler. Böylece ikisi birden aktif görünmez ve detay
 * sayfalarında da doğru öğe seçili kalır. Cari dışı yollar için null döner.
 */
function cariActiveHref(
  pathname: string,
  search?: URLSearchParams | null
): "/cari/musteri" | "/cari/tedarikci" | null {
  if (pathname.startsWith("/cari/customers")) return "/cari/musteri"
  if (pathname.startsWith("/cari/suppliers")) return "/cari/tedarikci"
  if (pathname === "/cari") {
    // Liste sayfası: tab=suppliers → Tedarikçi, aksi halde (varsayılan) Müşteri.
    return search?.get("tab") === "suppliers" ? "/cari/tedarikci" : "/cari/musteri"
  }
  return null
}

export function navItemActive(
  pathname: string,
  href: string,
  search?: URLSearchParams | null
) {
  if (pathname === href) return true
  if (href === "/dashboard") return false
  // Cari öğeleri paylaşımlı route'a sahip; tek bir öğe aktif olmalı.
  if (href === "/cari/musteri" || href === "/cari/tedarikci") {
    return cariActiveHref(pathname, search) === href
  }
  // Redirect eden bir nav öğesinin landing path'indeyiz: yalnızca o
  // alias'a ait href(ler) aktif olmalı. Aksi halde örn. /depolar/transfer
  // hem "Stok Transfer" (alias) hem de parent "Depo Listesi" (startsWith)
  // için aktif sayılır ve iki öğe birden seçili görünür.
  const aliasTargets = NAV_HREF_REDIRECT_ALIASES[pathname]
  if (aliasTargets) return aliasTargets.includes(href)
  // Alt-yol eşleşmesi (örn. /personel → /personel/123 detay). Ancak parent href
  // tüm kardeş öğeleri de kapsar (/personel, /personel/ik'yi de startsWith eder),
  // bu yüzden yalnızca DAHA SPESİFİK (daha uzun) başka bir nav öğesi pathname'i
  // eşleştirmiyorsa aktif say. Böylece /personel/ik'te yalnızca "İnsan Kaynakları"
  // aktif olur; /personel/123 gibi öğesiz alt yolda ise "Personeller" aktif kalır.
  if (!pathname.startsWith(href + "/")) return false
  const hasMoreSpecific = allNavItems.some(
    (item) =>
      item.href !== href &&
      item.href.length > href.length &&
      (pathname === item.href || pathname.startsWith(item.href + "/")),
  )
  return !hasMoreSpecific
}

/**
 * Grubundan farklı bir modüle bağlı sayfalar. Grup taramasından ÖNCE bakılır,
 * böylece ModuleGuard URL ile doğrudan girişi de doğru modüle göre kilitler.
 * (Menüdeki karşılığı: NavItemDef.module)
 */
const PATH_MODULE_OVERRIDES: Record<string, string> = {
  // Eski reçete adresi. Ekran /restoran/menu'ye taşındı ve orası grubundan
  // (Restoran & Kafe) zaten `restaurant` çözüyor; bu satır yalnızca eski adrese
  // gelen linkler için duruyor — yönlendirme öncesi de kilitli kalsın.
  "/stok/receteler": "restaurant",
}

/**
 * Bir path'in hangi yönetilebilir modüle ait olduğunu döndürür (yoksa null).
 * Modül route guard'ı bunu kullanarak kapalı modüllerin sayfalarını engeller.
 */
export function moduleKeyForPath(pathname: string): string | null {
  for (const [prefix, moduleKey] of Object.entries(PATH_MODULE_OVERRIDES)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return moduleKey
  }
  for (const group of navGroups) {
    const moduleKey = MODULE_GROUP_TO_KEY[group.title]
    if (!moduleKey) continue
    for (const href of group.hrefs) {
      if (pathname === href || pathname.startsWith(href + "/")) {
        return moduleKey
      }
    }
  }
  return null
}
