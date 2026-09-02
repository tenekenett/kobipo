// Panel sayfa kataloğu — hangi sayfa var, hangi rol görür, hangi modüle ait.
//
// NEDEN lib/ ALTINDA VE İKONSUZ: bu liste artık yalnızca menüyü çizmiyor, sunucu
// tarafı yetki kapısının da kaynağı (bkz. lib/page-access.ts). `nav-config.tsx`
// bir istemci bileşeni ve lucide ikonlarını import ediyor; onu sunucu koduna
// çekmek ikon paketini API bundle'ına sokardı. Bu yüzden VERİ burada, İKONLAR
// orada: `nav-config.tsx` bu dosyayı okuyup her öğeye ikonunu takar.
//
// Rol listesi bu dosyada TEK kez yazılır. İkinci bir kopya, "menü ne diyor, kapı
// ne diyor" ayrışmasına ve sessiz yetki açıklarına yol açardı.

import { MANAGEABLE_MODULES, MODULE_GROUP_TO_KEY } from "@/lib/modules"

export type NavPageDef = {
  href: string
  label: string
  roles: string[]
  /**
   * Öğeyi grubundan BAĞIMSIZ olarak bu modüle bağlar. Verilmezse öğe grubunun
   * modülünü miras alır.
   *
   * Örn. "Reçeteler" sayfası Stok grubunda yaşasaydı yalnızca Restoran & Kafe
   * paketi olanlara görünmesi için bu alan gerekirdi.
   */
  module?: string
}

export const ALL_ROLES = ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"]

// Şube müdürü, şubede operasyonel olarak ADMIN ile aynı yetkilere sahiptir; yalnızca
// hesap/yönetim düzeyindeki şu öğeler KISITLIDIR (BRANCH_MANAGER eklenmez):
// Kullanıcı Yönetimi (/ayarlar/ekip), Şube Yönetimi (/ayarlar/subeler),
// Abonelik (/ayarlar/abonelik) ve Şube Müdürleri (/ayarlar/sube-mudurleri).
const BM = "BRANCH_MANAGER"

export const NAV_PAGES: NavPageDef[] = [
  { href: "/dashboard", label: "Dashboard", roles: ALL_ROLES },

  // Satış
  { href: "/satis/fatura", label: "Satış Faturası", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/cari/musteri", label: "Müşteri", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/satis/irsaliye", label: "Satış İrsaliyesi", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES", "STOCK"] },
  { href: "/satis/siparis", label: "Satış Siparişi", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/satis/hizli", label: "Hızlı Satış", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/satis/fisler", label: "Satış Fişleri", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/teklif", label: "Teklif", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },

  // Alış
  { href: "/alis/fatura", label: "Alış Faturası", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/gelen-e-faturalar", label: "Gelen E-Faturalar", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/cari/tedarikci", label: "Tedarikçi", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/irsaliye", label: "Alış İrsaliyesi", roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK"] },
  { href: "/alis/siparis", label: "Alış Siparişi", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/hizli", label: "Hızlı Alış", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/fisler", label: "Alış Fişleri", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/fis-tarama", label: "Fiş Tarama", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/alis/teklif", label: "Satın Alma Teklifi", roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Stok
  { href: "/stok/urunler", label: "Ürün Listesi", roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/stok/hizmetler", label: "Hizmet Listesi", roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/depolar", label: "Depo Listesi", roles: ["ADMIN", BM, "STOCK"] },
  { href: "/stok/transfer", label: "Stok Transfer", roles: ["ADMIN", BM, "STOCK"] },
  { href: "/stok/etiket", label: "Etiket Tasarımı", roles: ["ADMIN", BM, "STOCK", "SALES"] },

  // Restoran & Kafe — kurulum (menü/reçete), kullanım (satış) ve ölçüm (raporlar)
  // aynı grupta. Reçete ekranı eskiden Stok grubundaydı; kafeci menüyü kurmak
  // için iki grup arasında gidip geliyordu. Reçete MANTIĞI hâlâ lib/stock'ta —
  // taşınan yalnızca ekranın adresi (bkz. docs/restoran/SADELESTIRME.md "İş 3").
  { href: "/restoran/masalar", label: "Masalar", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  // Aynı masaların LİSTE hâli: kroki masanın yerini anlatır, servis sırasında
  // yalnız adı lazım. Dokunmatik kasada hedefler büyük ve sabit kalsın diye ayrı
  // ekran — davranış krokiyle ortak (lib/restoran/use-table-opener.ts).
  { href: "/restoran/masa-listesi", label: "Masa Listesi", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  // Salon planı masaya bakar; bu liste hesaba. Masasız (paket/gel-al) adisyonun
  // açılabildiği ve görülebildiği tek yer burası — ayrıca kapanmış adisyonun
  // gün bazında görülebildiği tek yer (gün sonu raporu fişleri sayar).
  { href: "/restoran/adisyonlar", label: "Adisyonlar", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/restoran/satis", label: "Kahveci Satış", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES"] },
  { href: "/restoran/menu", label: "Menü & Reçeteler", roles: ["ADMIN", BM, "STOCK", "ACCOUNTANT"] },
  // Açılış/kapanış listesini KURAN ve uyumu ÖLÇEN ekran → patron/müdür. Personel
  // maddeleri buradan değil, satış ekranındaki uyarı şeridinden onaylar; o yüzden
  // SALES bu sayfayı görmez ama tik atmaya devam eder.
  { href: "/restoran/kontrol-listesi", label: "Kontrol Listesi", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/restoran/raporlar", label: "Raporlar", roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Finans
  { href: "/finans/kanallar", label: "Finans Kanalları", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/finans/hareketler", label: "Finans Hareketleri", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/finans/mutabakat", label: "Mutabakat", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/cek-senet/cek", label: "Çek Portföyü", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/cek-senet/senet", label: "Senet Portföyü", roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Raporlar
  { href: "/raporlar/satis", label: "Satış Raporları", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES", "VIEWER"] },
  { href: "/raporlar/alis", label: "Alış Raporları", roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/cari", label: "Cari Raporlar", roles: ["ADMIN", BM, "ACCOUNTANT", "SALES", "VIEWER"] },
  { href: "/raporlar/vergi", label: "Vergi Raporları", roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/nakit-banka", label: "Nakit & Banka", roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },
  { href: "/raporlar/stok", label: "Stok Raporları", roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES", "VIEWER"] },
  { href: "/raporlar/personel", label: "Personel Raporları", roles: ["ADMIN", BM, "ACCOUNTANT", "VIEWER"] },

  // Personel
  { href: "/personel", label: "Personeller", roles: ["ADMIN", BM] },
  { href: "/personel/maas", label: "Maaş-Ödemeler", roles: ["ADMIN", BM] },
  { href: "/personel/vardiya", label: "Vardiya Takvimi", roles: ["ADMIN", BM] },
  { href: "/personel/puantaj", label: "Aylık Puantaj", roles: ["ADMIN", BM] },
  { href: "/personel/izin", label: "İzin-Devam", roles: ["ADMIN", BM] },
  { href: "/personel/zimmet", label: "Zimmet", roles: ["ADMIN", BM] },
  { href: "/personel/ik", label: "İnsan Kaynakları", roles: ["ADMIN", BM] },

  // Muhasebe defterleri — KATALOGDA VAR, MENÜDE YOK.
  //
  // Ekranlar (`/muhasebe/yevmiye`, `/muhasebe/kebir`) mali tablolardan link ile
  // açılıyor; sidebar'a öğe eklenmedi. Buraya yazılmalarının sebebi menü değil YETKİ:
  // katalog dışında kaldıkları sürece sayfa kapısı onlara hiç uygulanmıyor,
  // `/api/muhasebe/*` kuralı bir sahibe bağlanamıyor ve defter özel role
  // verilemiyordu. Katalogda oldukları için rol seçicisinde "Genel" başlığı altında
  // görünürler (bkz. page-permission-picker "loose" dalı) — /dashboard ile aynı desen.
  { href: "/muhasebe/yevmiye", label: "Yevmiye Defteri", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/muhasebe/kebir", label: "Kebir Defteri", roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // E-Dönüşüm
  { href: "/ayarlar/e-donusum", label: "E-Dönüşüm Ayarları", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/e-donusum/kontor", label: "Kontör", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/e-donusum/seri-no", label: "Seri No Tanımları", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/e-donusum/sablon", label: "Belge Şablonları", roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Ayarlar
  { href: "/ayarlar/firma", label: "Firma Bilgileri", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/ayarlar/fis-tasarim", label: "Fiş Tasarımı", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  { href: "/ayarlar/tanimlar", label: "Tanımlar", roles: ["ADMIN", BM, "ACCOUNTANT"] },
  // KISITLI: yalnız ADMIN
  // Etiket sayfanın kendi başlığıyla aynı olmalı: menüde "Kullanıcı Yönetimi",
  // içeride "Ekip Yönetimi" yazıyordu ve sayfa aranırken bulunamıyordu.
  { href: "/ayarlar/ekip", label: "Ekip Yönetimi", roles: ["ADMIN"] },
  { href: "/ayarlar/roller", label: "Rol Yetkileri", roles: ["ADMIN"] },
  { href: "/ayarlar/sube-mudurleri", label: "Şube Müdürleri", roles: ["ADMIN"] },
  { href: "/ayarlar/abonelik", label: "Abonelik", roles: ["ADMIN"] },
  { href: "/ayarlar/subeler", label: "Şube Yönetimi", roles: ["ADMIN"] },
  { href: "/ayarlar/veri-aktarim", label: "Veri Aktarım", roles: ["ADMIN", BM, "ACCOUNTANT", "STOCK", "SALES"] },
  { href: "/ayarlar/sube-bilgileri", label: "Şube Bilgileri", roles: ["ADMIN", BM, "ACCOUNTANT"] },

  // Standalone (sidebar bottom)
  { href: "/ayarlar/destek", label: "Destek", roles: ALL_ROLES },
  { href: "/ayarlar/profil", label: "Profil", roles: ALL_ROLES },
]

/**
 * Kenar çubuğundaki grupların İÇERİĞİ. Sıra buradaki sıradır.
 *
 * DİKKAT — yeni bir sayfa İKİ yere birden eklenir: yukarıdaki `NAV_PAGES`
 * (etiket + rol) ve buradaki grup `hrefs` listesi. Yalnız `NAV_PAGES`'e eklenen
 * öğe hiçbir grupta yer almadığı için kenar çubuğunda GÖRÜNMEZ — sayfa çalışır,
 * adresine gidilebilir, ama menüden ulaşılamaz.
 */
export const NAV_GROUPS: Array<{ title: string; hrefs: string[] }> = [
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
      "/alis/fis-tarama",
      "/alis/teklif",
    ],
  },
  {
    title: "Stok",
    hrefs: ["/stok/urunler", "/stok/hizmetler", "/depolar", "/stok/transfer", "/stok/etiket"],
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
      "/ayarlar/roller",
      "/ayarlar/sube-mudurleri",
      "/ayarlar/abonelik",
      "/ayarlar/veri-aktarim",
      "/ayarlar/subeler",
      "/ayarlar/sube-bilgileri",
    ],
  },
]

/** Gruplardan sonra düz link olarak çizilen öğeler. */
export const STANDALONE_NAV_HREFS: string[] = [
  "/e-donusum/kontor",
  "/ayarlar/destek",
  "/ayarlar/profil",
]

/**
 * Bazı nav öğeleri tıklanınca farklı bir landing path'e yönlendirir
 * (server-side redirect). Bu durumda gerçek pathname nav href ile
 * eşleşmediği için ilgili öğe aktif sayılmaz ve menü grubu kapanır.
 * Aşağıdaki eşleme "landing path -> nav href(ler)" ile bu öğeleri de
 * aktif kabul ederek dropdown'ın açık kalmasını sağlar.
 */
export const NAV_HREF_REDIRECT_ALIASES: Record<string, string[]> = {
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
export function cariActiveHref(
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

export function navItemActive(pathname: string, href: string, search?: URLSearchParams | null) {
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
  const hasMoreSpecific = NAV_PAGES.some(
    (item) =>
      item.href !== href &&
      item.href.length > href.length &&
      (pathname === item.href || pathname.startsWith(item.href + "/"))
  )
  return !hasMoreSpecific
}

/**
 * Grubundan farklı bir modüle bağlı sayfalar. Grup taramasından ÖNCE bakılır,
 * böylece ModuleGuard URL ile doğrudan girişi de doğru modüle göre kilitler.
 * (Menüdeki karşılığı: NavPageDef.module)
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
  // Sayfanın kendi açık bağı grubunu EZER (`NavPageDef.module`); bugün kullanan yok
  // ama sözleşme tipte yazılı ve tek çözüm noktası burası olmalı.
  const own = navPage(pathname)?.module
  if (own) return own
  for (const group of NAV_GROUPS) {
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

const PAGE_BY_HREF = new Map(NAV_PAGES.map((p) => [p.href, p]))

export function navPage(href: string): NavPageDef | undefined {
  return PAGE_BY_HREF.get(href)
}

/** Rolün görebildiği sayfa href'leri — yetki kapısının TABANI. */
/**
 * e-Dönüşüm sayfaları. AYRI bir eksen: modül değil, firma bayrağıdır
 * (`company.isEDonusumEnabled`) — bu yüzden `MODULE_GROUP_TO_KEY`'de karşılığı yok ve
 * modül süzgecinden hiç geçmiyorlardı. Kontör linki gruplarda değil, düz link
 * (`STANDALONE_NAV_HREFS`) olduğu için ayrıca yazılıyor.
 */
/**
 * Canlıda yalnız SEÇİLİ firmalarla yürütülen DENEME sayfaları.
 *
 * e-Dönüşüm gibi modüle değil firma bayrağına bağlı — ama TERS yönde: bayrak
 * açıkça true değilse sayfa yok (fail-closed). Bayrağın kaynağı
 * FIS_TARAMA_COMPANIES env listesi, sunucuda çözülür (lib/fis-ocr/access.ts).
 *
 * Buradaki gizleme KOZMETİK: gerçek kapı, parayı harcayan uçta.
 */
export const DENEME_PAGES: string[] = ["/alis/fis-tarama"]

export const E_DONUSUM_PAGES: string[] = [
  ...(NAV_GROUPS.find((g) => g.title === "E-Dönüşüm")?.hrefs ?? []),
  "/e-donusum/kontor",
]

/** Firmanın o anki durumu: hangi modüller kapalı, e-Dönüşüm açık mı. */
export type PageAvailability = {
  /** RED listesi (`company.disabledModules`). */
  disabledModules?: string[] | null
  /** Yalnız AÇIKÇA false verilirse e-Dönüşüm sayfaları elenir; undefined = dokunma. */
  isEDonusumEnabled?: boolean
}

/** Sayfa, firmanın bugünkü modül durumunda kullanılabilir mi? */
export function isPageAvailable(href: string, availability?: PageAvailability): boolean {
  if (!availability) return true
  if (availability.isEDonusumEnabled === false && E_DONUSUM_PAGES.includes(href)) return false
  const key = moduleKeyForPath(href)
  return !(key && (availability.disabledModules ?? []).includes(key))
}

export function filterAvailablePages(hrefs: string[], availability?: PageAvailability): string[] {
  if (!availability) return hrefs
  return hrefs.filter((href) => isPageAvailable(href, availability))
}

/**
 * Bu sayfa kümesinin ihtiyaç duyduğu ama firmada KAPALI olan modüllerin etiketleri.
 *
 * Sayının kendisi yetmiyor: "7 yerine 4 sayfa" demek kullanıcıya neyi satın alması
 * gerektiğini söylemez. Etiket `lib/modules.ts`'teki tanımdan geliyor, yani satın alma
 * ekranında gördüğü isimle birebir aynı.
 */
export function missingModuleLabels(
  hrefs: string[],
  availability?: PageAvailability
): string[] {
  if (!availability) return []
  const labels: string[] = []
  const push = (label: string) => {
    if (!labels.includes(label)) labels.push(label)
  }
  for (const href of hrefs) {
    if (isPageAvailable(href, availability)) continue
    if (E_DONUSUM_PAGES.includes(href)) {
      push("e-Dönüşüm")
      continue
    }
    const key = moduleKeyForPath(href)
    const def = key ? MANAGEABLE_MODULES.find((m) => m.key === key) : null
    if (def) push(def.label)
  }
  return labels
}

/**
 * Sayfa doğası gereği salt-okunur mu (yazma eylemi hiç yok)?
 *
 * Raporlar ve dashboard herkes için okumadır; "salt-okunur" uyarısı orada bilgi
 * taşımaz, yalnız gürültü yapar — özellikle VIEWER'da, çünkü gördüğü sayfaların
 * neredeyse tamamı bunlar.
 */
export function isReadOnlyByNature(href: string): boolean {
  return href === "/dashboard" || href.startsWith("/raporlar/")
}

export function pagesForRole(role: string, availability?: PageAvailability): string[] {
  const pages = NAV_PAGES.filter((p) => p.roles.includes(role)).map((p) => p.href)
  return filterAvailablePages(pages, availability)
}

/**
 * Hesabın KENDİSİNİ yöneten ekranlar. Yalnız enum ADMIN'e aittir ve firmanın
 * tanımladığı özel rollere DEVREDİLEMEZ.
 *
 * Sebep basit ve pazarlıksız: bu sayfalar yetki dağıtır. Ekip Yönetimi'ne erişen bir
 * özel rol sahibi kendi rolünü düzenleyip yetkisini sınırsıza çıkarabilir, yani
 * kısıtlama sistemi kendi kendini geçersiz kılardı. Şube/abonelik ekranları da
 * hesabın ticari kimliğini değiştirir (şube açma, paket satın alma).
 *
 * Liste türetilmiyor, AÇIK yazılıyor: bir sayfanın rol matrisi ileride gevşetilirse
 * (ör. ACCOUNTANT'a da açılırsa) bu sınırın sessizce kaybolmasını istemiyoruz.
 */
export const ACCOUNT_ADMIN_PAGES = [
  "/ayarlar/ekip",
  // Rol tanımlama ekranı bu listenin EN kritik üyesi: buraya erişen biri kendi rolünü
  // düzenleyip her yetkiyi kendine yazabilirdi.
  "/ayarlar/roller",
  "/ayarlar/subeler",
  "/ayarlar/sube-mudurleri",
  "/ayarlar/abonelik",
]

/**
 * Herkese açık kişisel sayfalar. Özel rol tanımlanırken seçilmezler bile bu ikisi
 * verilir — kimse kendi profiline ve destek talebine kapatılamamalı.
 */
export const ALWAYS_AVAILABLE_PAGES = ["/ayarlar/profil", "/ayarlar/destek"]

/**
 * Bir özel role verilebilecek sayfalar: hesap yönetimi dışındaki her şey.
 * Enum rollerinin matrisiyle sınırlı DEĞİLDİR — özel rolün varlık sebebi zaten
 * o matrisin yetmemesi.
 */
export function assignablePages(availability?: PageAvailability): string[] {
  const pages = NAV_PAGES.filter((p) => !ACCOUNT_ADMIN_PAGES.includes(p.href)).map((p) => p.href)
  return filterAvailablePages(pages, availability)
}
