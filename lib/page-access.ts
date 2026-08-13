// Kısıtlı çalışan izinlerinin SUNUCU tarafı kapısı.
//
// `lib/module-access.ts` ile aynı desen ve aynı boru hattı: kökteki proxy.ts isteğin
// yolunu header'a yazar, `ensureCompanyAccess` her istekte önce modül kapısını sonra
// bu kapıyı uygular. Fark, kapının neye baktığı:
//
//   module-access  → firma o modülü SATIN ALDI mı?      (firma bazında)
//   page-access    → bu KULLANICI o sayfayı görebilir mi? (üyelik bazında)
//
// MODEL: efektif izin = rol matrisi (lib/nav/pages.ts `roles`) ∩ allowedPaths.
// Listeye yazılan bir sayfa, rolün zaten göremediği bir ekranı AÇMAZ — izin listesi
// yalnız daraltır. Böylece rol tek yetki kaynağı olarak kalır.
//
// KAPSAM — dikkat: bu kapı bugün YALNIZCA kısıtlı üyeliklere (allowedPaths dolu)
// uygulanır; bkz. ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED. Kısıtsız kullanıcılar için
// davranış bugünküyle birebir aynıdır.

import {
  ALWAYS_AVAILABLE_PAGES,
  NAV_PAGES,
  assignablePages,
  cariActiveHref,
  pagesForRole,
} from "@/lib/nav/pages"
import { roleToDashboardPath } from "@/lib/auth/role-paths"

export type PageApiRule = {
  /** `/api/...` ön eki. En UZUN eşleşen kural kazanır. */
  prefix: string
  /**
   * Bu ucu OKUYAN sayfalar — kullanıcının izinli sayfalarından HERHANGİ BİRİ
   * listedeyse geçer. Bir uç birden çok ekranın ihtiyacıdır: müşteri listesini
   * cari ekranı da, satış faturasının kalem seçicisi de, kahveci satış ekranı da
   * çeker. Liste dar yazılırsa izinli bir ekran çalışmaz hâle gelir.
   */
  pages: string[]
  /** Bu uca YAZAN sayfalar. Verilmezse `pages` geçerlidir. */
  writePages?: string[]
}

/**
 * Rol matrisi kısıtsız kullanıcılara da uygulansın mı?
 *
 * BUGÜN false — ve bu bilinçli bir kademelendirme. Rol matrisi (nav-config'teki
 * `roles`) bugüne kadar YALNIZCA menüyü çiziyordu, hiçbir uç onu doğrulamıyordu.
 * Aşağıdaki haritayı bir anda tüm kullanıcılara uygulamak, haritadaki tek bir dar
 * satırın çalışan bir ekranı üretimde kırması demekti.
 *
 * Kısıtlı üyelikler (allowedPaths dolu) için kapı HER HÂLÜKÂRDA çalışır: özelliğin
 * kendisi budur ve orada dar bir satırın bedeli tek çalışanın tek ekranıdır.
 *
 * Bunu true yapmak, güvenlik taramasındaki "çapraz-modül yazma matrisi" bulgusunu
 * (SALES ↛ stok yazma) kapatır — ayrı bir iş olarak, harita üretimde denendikten
 * sonra açılmalı.
 */
export const ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED = false

/** Bir üyeliğin izin durumu — `UserCompany` satırından türer. */
export type PagePermissions = {
  role: string
  allowedPaths: string[]
  writablePaths: string[]
  /**
   * Yetki firmanın tanımladığı ÖZEL rolden geliyorsa true (`role` = CUSTOM).
   *
   * Tavanı değiştirir: hazır rollerde tavan o rolün matrisidir, özel rolde ise
   * hesap yönetimi dışındaki TÜM sayfalardır (`assignablePages`). Özel rolün varlık
   * sebebi zaten hazır matrisin yetmemesi; onu yine matrisle sınırlamak özelliği
   * anlamsız kılardı.
   */
  custom?: boolean
}

const ALL_NAV_HREFS = NAV_PAGES.map((p) => p.href)

const REPORT_PAGES = ALL_NAV_HREFS.filter((h) => h.startsWith("/raporlar/"))
const PERSONNEL_PAGES = ALL_NAV_HREFS.filter((h) => h === "/personel" || h.startsWith("/personel/"))
const RESTAURANT_PAGES = ALL_NAV_HREFS.filter((h) => h.startsWith("/restoran/"))
/** Adisyon/masa üçlüsü: aynı veriyi üç ekran da okur (kroki, liste, adisyon listesi). */
const TICKET_PAGES = ["/restoran/masalar", "/restoran/masa-listesi", "/restoran/adisyonlar"]
/** Belge düzenleyen ekranlar müşteri/ürün listesini kalem seçici olarak okur. */
const SALES_DOC_PAGES = [
  "/satis/fatura",
  "/satis/irsaliye",
  "/satis/siparis",
  "/satis/hizli",
  "/satis/fisler",
  "/teklif",
]
const PURCHASE_DOC_PAGES = [
  "/alis/fatura",
  "/alis/irsaliye",
  "/alis/siparis",
  "/alis/hizli",
  "/alis/fisler",
  "/alis/teklif",
]

/**
 * Uç → o ucu kullanan sayfalar.
 *
 * Liste TAHMİNLE değil, sayfa dosyalarından başlayıp yerel importları transitif
 * izleyen bir tarama ile çıkarıldı; aşağıdaki "şaşırtıcı" satırlar (kontrol listesi
 * yazmasının satış ekranından gelmesi, çek portföyünün müşteri listesi okuması)
 * o taramanın bulgularıdır — sadeleştirmeyin, ekran kırılır.
 *
 * KURALI OLMAYAN UÇ SERBESTTİR. Oturum, profil, destek, abonelik, kontör, firma
 * kaydı ve VKN sorgusu gibi uçlar sayfa iznine tabi değildir: bunlar panelde hangi
 * ekranın açık olduğundan bağımsız olarak hesabın kendi işleridir.
 */
export const PAGE_API_RULES: PageApiRule[] = [
  // ---- Cari --------------------------------------------------------------
  {
    prefix: "/api/cari/customers",
    pages: [
      "/cari/musteri",
      ...SALES_DOC_PAGES,
      "/alis/hizli",
      "/cek-senet/cek",
      "/cek-senet/senet",
      "/finans/hareketler",
      "/restoran/satis",
      ...TICKET_PAGES,
      "/ayarlar/sube-bilgileri",
      "/raporlar/cari",
      "/raporlar/satis",
    ],
    writePages: ["/cari/musteri"],
  },
  {
    prefix: "/api/cari/suppliers",
    pages: [
      "/cari/tedarikci",
      ...PURCHASE_DOC_PAGES,
      "/satis/hizli",
      "/satis/irsaliye",
      "/cek-senet/cek",
      "/cek-senet/senet",
      "/finans/hareketler",
      "/restoran/satis",
      ...TICKET_PAGES,
      "/raporlar/cari",
      "/raporlar/alis",
    ],
    writePages: ["/cari/tedarikci"],
  },
  {
    prefix: "/api/cari/open-invoices",
    pages: ["/cari/musteri", "/cari/tedarikci", "/finans/hareketler", "/finans/kanallar"],
  },
  { prefix: "/api/cari/ekstre", pages: ["/cari/musteri", "/cari/tedarikci", "/raporlar/cari"] },
  { prefix: "/api/cari", pages: ["/cari/musteri", "/cari/tedarikci", "/raporlar/cari"] },

  // ---- Satış / alış belgeleri --------------------------------------------
  // Belge uçları YÖNÜ yolda taşımaz (`?type=SALES` gibi query ile ayrışır), bu yüzden
  // satış ve alış ekranlarının ikisi de listede. Modül kapısındaki bilinçli boşluğun
  // (bkz. module-access.ts) sayfa tarafındaki eşi: yalnız satış izni olan biri, bir
  // alış faturasının id'sini bilirse okuyabilir.
  {
    prefix: "/api/faturalar/odemeler",
    pages: [
      "/satis/fatura",
      "/alis/fatura",
      "/satis/hizli",
      "/alis/hizli",
      "/finans/hareketler",
      "/restoran/satis",
      ...TICKET_PAGES,
    ],
  },
  {
    prefix: "/api/faturalar",
    // Rapor ekranları BURAYI okumaz — kendi uçları var (/api/raporlar/*, /api/export/rapor-*)
    // ve fatura listesini `/api/e-donusum/invoices` üzerinden alırlar. Rapor sayfalarını
    // buraya eklemek, "yalnız satış raporu" izni olan birine ham fatura listesini açardı.
    pages: ["/satis/fatura", "/alis/fatura"],
    writePages: ["/satis/fatura", "/alis/fatura"],
  },
  { prefix: "/api/irsaliye", pages: ["/satis/irsaliye", "/alis/irsaliye"] },
  { prefix: "/api/e-irsaliye", pages: ["/satis/irsaliye", "/alis/irsaliye"] },
  { prefix: "/api/siparis", pages: ["/satis/siparis", "/alis/siparis"] },
  { prefix: "/api/teklif", pages: ["/teklif", "/alis/teklif"] },
  {
    prefix: "/api/fisler",
    pages: ["/satis/fisler", "/alis/fisler", "/cari/musteri", "/cari/tedarikci"],
    writePages: ["/satis/fisler", "/alis/fisler"],
  },

  // ---- Stok / depo -------------------------------------------------------
  { prefix: "/api/stok/movements", pages: ["/raporlar/stok", "/stok/urunler", "/satis/fatura", "/alis/fatura"] },
  {
    prefix: "/api/stok/etiket-sablonlari",
    pages: ["/stok/etiket", "/satis/fatura", "/alis/fatura"],
    writePages: ["/stok/etiket"],
  },
  {
    prefix: "/api/stok",
    pages: [
      "/stok/urunler",
      "/stok/hizmetler",
      "/stok/etiket",
      "/stok/transfer",
      "/depolar",
      ...SALES_DOC_PAGES,
      ...PURCHASE_DOC_PAGES,
      "/restoran/menu",
      "/restoran/satis",
      ...TICKET_PAGES,
      "/raporlar/stok",
      "/ayarlar/sube-bilgileri",
    ],
    writePages: ["/stok/urunler", "/stok/hizmetler"],
  },
  { prefix: "/api/depolar/transfer", pages: ["/stok/transfer", "/depolar"] },
  {
    prefix: "/api/depolar/stok",
    pages: [
      "/depolar",
      "/stok/urunler",
      "/stok/transfer",
      "/satis/hizli",
      "/alis/hizli",
      "/restoran/menu",
      "/restoran/satis",
      ...TICKET_PAGES,
      "/raporlar/stok",
    ],
  },
  {
    prefix: "/api/depolar",
    pages: [
      "/depolar",
      "/stok/urunler",
      "/stok/transfer",
      "/satis/hizli",
      "/alis/hizli",
      "/restoran/menu",
      "/restoran/satis",
      ...TICKET_PAGES,
    ],
    writePages: ["/depolar"],
  },

  // ---- Finans ------------------------------------------------------------
  {
    prefix: "/api/finans/accounts",
    // Ödeme alan/yapan her ekran kanal listesini okur — bordro ödemesi dahil.
    pages: [
      "/finans/kanallar",
      "/finans/hareketler",
      "/finans/mutabakat",
      "/satis/fatura",
      "/alis/fatura",
      "/satis/hizli",
      "/alis/hizli",
      "/teklif",
      "/cari/musteri",
      "/cari/tedarikci",
      "/restoran/satis",
      ...TICKET_PAGES,
      "/personel/maas",
      "/e-donusum/sablon",
    ],
    writePages: ["/finans/kanallar"],
  },
  {
    prefix: "/api/finans/transactions",
    // BİLİNEN GRANÜLERLİK SINIRI: cari detay ekranı o carinin hareketlerini burada
    // okuyor, bu yüzden "Müşteri" izni ucu açıyor — ama uç müşteriye göre daraltılmış
    // DEĞİL, filtresiz çağrılırsa firmanın tüm hareketlerini döndürür. Sayfa izniyle
    // çözülemez; uç seviyesinde kapsam (ör. zorunlu cariId) gerekir. Kaldırmak yanlış
    // olur: cari detayı kırılır ve kısıt daha da yanıltıcı hâle gelir.
    pages: ["/finans/hareketler", "/finans/kanallar", "/cari/musteri", "/cari/tedarikci"],
    writePages: ["/finans/hareketler", "/finans/kanallar"],
  },
  { prefix: "/api/finans", pages: ["/finans/kanallar", "/finans/hareketler", "/finans/mutabakat"] },
  { prefix: "/api/kasa", pages: ["/finans/kanallar", "/finans/hareketler"] },
  { prefix: "/api/banka", pages: ["/finans/mutabakat", "/finans/kanallar", "/finans/hareketler"] },
  {
    prefix: "/api/cek-senet",
    pages: [
      "/cek-senet/cek",
      "/cek-senet/senet",
      "/cari/musteri",
      "/cari/tedarikci",
      "/finans/hareketler",
      "/finans/kanallar",
    ],
    writePages: ["/cek-senet/cek", "/cek-senet/senet"],
  },

  // ---- Raporlar ----------------------------------------------------------
  { prefix: "/api/raporlar/personel", pages: ["/raporlar/personel", "/personel/puantaj"] },
  { prefix: "/api/raporlar/nakit-akisi", pages: ["/raporlar/nakit-banka"] },
  { prefix: "/api/raporlar/cari-yaslandirma", pages: ["/raporlar/cari"] },
  { prefix: "/api/raporlar/ba-bs", pages: ["/raporlar/vergi"] },
  { prefix: "/api/raporlar/kdv", pages: ["/raporlar/vergi"] },
  { prefix: "/api/raporlar/muhtasar", pages: ["/raporlar/vergi"] },
  // Mali tablolar. Menüde kendi öğeleri yok (/raporlar/bilanco, /raporlar/kar-zarar
  // adreslerinden açılıyorlar), o yüzden genel `/api/raporlar` kuralına düşüyorlardı —
  // yani "yalnız Satış Raporları" izni olan biri kâr-zararı okuyabiliyordu. Firmanın
  // bütününü gösterdikleri için finansal rapor öğelerine bağlandılar.
  { prefix: "/api/raporlar/kar-zarar", pages: ["/raporlar/nakit-banka", "/raporlar/vergi"] },
  { prefix: "/api/raporlar/bilanco", pages: ["/raporlar/nakit-banka", "/raporlar/vergi"] },
  { prefix: "/api/raporlar/gelir-gider", pages: ["/raporlar/nakit-banka", "/raporlar/vergi"] },
  { prefix: "/api/raporlar", pages: REPORT_PAGES },

  // ---- Personel ----------------------------------------------------------
  // Bordro, izin, zimmet ve özlük dosyası aynı modülün İÇİNDE bile birbirinden
  // ayrılır: "vardiya girsin ama maaşları görmesin" en sık istenen kısıt.
  {
    prefix: "/api/personel/payroll",
    pages: ["/personel/maas", "/personel/puantaj", "/personel"],
    writePages: ["/personel/maas"],
  },
  {
    prefix: "/api/personel/shifts",
    pages: ["/personel/vardiya", "/personel/puantaj", "/personel", "/raporlar/personel"],
    writePages: ["/personel/vardiya"],
  },
  { prefix: "/api/personel/shift-templates", pages: ["/personel/vardiya"] },
  { prefix: "/api/personel/holidays", pages: ["/personel/vardiya"] },
  { prefix: "/api/personel/opening-hours", pages: ["/personel/vardiya"] },
  {
    prefix: "/api/personel/leaves",
    pages: ["/personel/izin", "/personel/vardiya", "/personel"],
    writePages: ["/personel/izin"],
  },
  {
    prefix: "/api/personel/assets",
    pages: ["/personel/zimmet", "/personel"],
    writePages: ["/personel/zimmet"],
  },
  {
    prefix: "/api/personel/documents",
    pages: ["/personel/ik", "/personel"],
    writePages: ["/personel/ik"],
  },
  {
    prefix: "/api/personel/employees",
    // Restoran tarafı personel listesini ikram/iskonto sorumlusu seçmek için okur.
    pages: [...PERSONNEL_PAGES, "/restoran/satis", ...TICKET_PAGES],
    writePages: ["/personel"],
  },
  { prefix: "/api/personel", pages: PERSONNEL_PAGES },

  // ---- Restoran & Kafe ---------------------------------------------------
  { prefix: "/api/restoran/raporlar", pages: ["/restoran/raporlar"] },
  {
    prefix: "/api/restoran/kontrol-listesi",
    // Listeyi KURAN ekran ayrı, TİK ATAN ekran ayrı: personel maddeleri satış
    // ekranındaki uyarı şeridinden onaylar (bkz. lib/nav/pages.ts). Yazma listesi
    // bu yüzden satış/masa ekranlarını da içerir.
    pages: ["/restoran/kontrol-listesi", "/restoran/satis", ...TICKET_PAGES, "/restoran/raporlar"],
    writePages: ["/restoran/kontrol-listesi", "/restoran/satis", ...TICKET_PAGES],
  },
  { prefix: "/api/restoran/adisyonlar", pages: [...TICKET_PAGES, "/restoran/satis", "/restoran/raporlar"] },
  { prefix: "/api/restoran/masalar", pages: [...TICKET_PAGES, "/restoran/satis"] },
  { prefix: "/api/restoran/bolgeler", pages: [...TICKET_PAGES, "/restoran/menu"] },
  { prefix: "/api/restoran/plan", pages: ["/restoran/masalar"] },
  { prefix: "/api/restoran/rezervasyonlar", pages: ["/restoran/masalar", "/restoran/masa-listesi"] },
  {
    prefix: "/api/restoran/urun-secenekleri",
    pages: ["/restoran/menu", "/restoran/satis", ...TICKET_PAGES],
    writePages: ["/restoran/menu"],
  },
  {
    prefix: "/api/restoran/recipes",
    pages: ["/restoran/menu", "/restoran/satis", ...TICKET_PAGES, "/stok/urunler"],
    writePages: ["/restoran/menu"],
  },
  { prefix: "/api/restoran/ikram", pages: ["/restoran/satis", ...TICKET_PAGES] },
  {
    // Tavanı iskonto diyaloğu da OKUR (kasiyer sınırı görsün, "Uygula" boşuna
    // hata almasın); YAZMA ayarın yaşadığı rapor ekranına bağlıdır. Ucun kendi
    // içinde ayrıca ADMIN şartı var — bu kural sayfa kapısının payına düşen.
    prefix: "/api/restoran/iskonto-limiti",
    pages: ["/restoran/raporlar", "/restoran/satis", ...TICKET_PAGES],
    writePages: ["/restoran/raporlar"],
  },
  { prefix: "/api/restoran", pages: RESTAURANT_PAGES },

  // ---- E-Dönüşüm ---------------------------------------------------------
  // Yalnızca BELGE uçları kapıya tabi. VKN sorgusu, vergi/tevkifat kod listeleri ve
  // onboarding gibi yardımcı uçlar kuralsız bırakıldı: bunlar firma ayarının parçası,
  // hangi ekranın açık olduğuyla ilgisi yok.
  { prefix: "/api/e-donusum/inbox", pages: ["/alis/gelen-e-faturalar", "/alis/fatura", "/satis/fatura"] },
  {
    prefix: "/api/e-donusum/invoices",
    pages: [
      "/satis/fatura",
      "/alis/fatura",
      "/satis/hizli",
      "/alis/hizli",
      "/raporlar/satis",
      "/raporlar/alis",
      "/restoran/satis",
      ...TICKET_PAGES,
      "/ayarlar/sube-bilgileri",
    ],
    writePages: ["/satis/fatura", "/alis/fatura", "/satis/hizli", "/alis/hizli"],
  },
  { prefix: "/api/e-donusum/templates", pages: ["/e-donusum/sablon", "/e-donusum/seri-no"] },
  { prefix: "/api/e-donusum/series-templates", pages: ["/e-donusum/sablon", "/e-donusum/seri-no"] },
  { prefix: "/api/e-donusum/numerators", pages: ["/e-donusum/sablon", "/e-donusum/seri-no"] },

  // ---- Dışa/içe aktarma --------------------------------------------------
  // Kapalı sayfanın verisi export'tan sızmasın. Dataset adı yolun parçası olduğu için
  // ön ek eşleşmesi burada da çalışır (bkz. module-access.ts'teki aynı desen).
  { prefix: "/api/export/rapor-personel", pages: ["/raporlar/personel"] },
  { prefix: "/api/export/rapor-", pages: REPORT_PAGES },
  { prefix: "/api/export/personel-", pages: [...PERSONNEL_PAGES, "/raporlar/personel"] },
  { prefix: "/api/export/products", pages: ["/stok/urunler", "/stok/hizmetler", "/ayarlar/veri-aktarim"] },
  { prefix: "/api/export/invoices", pages: ["/satis/fatura", "/alis/fatura", "/ayarlar/veri-aktarim"] },
  { prefix: "/api/export/cari", pages: ["/cari/musteri", "/cari/tedarikci", "/ayarlar/veri-aktarim"] },
  { prefix: "/api/export/ekstre", pages: ["/cari/musteri", "/cari/tedarikci"] },
  { prefix: "/api/export/accountant", pages: ["/ayarlar/veri-aktarim"] },
  { prefix: "/api/import", pages: ["/ayarlar/veri-aktarim"] },

  // ---- Firma ayarları ----------------------------------------------------
  {
    prefix: "/api/company/definitions",
    pages: [
      "/ayarlar/tanimlar",
      "/cari/musteri",
      "/cari/tedarikci",
      "/stok/urunler",
      "/stok/hizmetler",
      "/restoran/menu",
      "/satis/fatura",
      "/alis/fatura",
      "/satis/hizli",
      "/alis/hizli",
    ],
    writePages: ["/ayarlar/tanimlar"],
  },
  {
    prefix: "/api/company/users",
    // Cari kartındaki "yetkili kullanıcı" seçicisi de ekip listesini okur.
    pages: ["/ayarlar/ekip", "/cari/musteri", "/cari/tedarikci"],
    writePages: ["/ayarlar/ekip"],
  },
  { prefix: "/api/company/invitations", pages: ["/ayarlar/ekip"] },
  // Rol tanımlama ucu. Route zaten enum ADMIN istiyor; buradaki kural ikinci kilittir
  // ve daha güçlüdür: "/ayarlar/roller" hiçbir özel role atanamadığı için (bkz.
  // ACCOUNT_ADMIN_PAGES) bu uç özel rol taşıyan bir üyelikte ASLA açılamaz.
  { prefix: "/api/company/roles", pages: ["/ayarlar/roller"] },
  { prefix: "/api/company/branch-managers", pages: ["/ayarlar/sube-mudurleri"] },
  {
    prefix: "/api/fis-tasarim",
    pages: ["/ayarlar/fis-tasarim", "/satis/hizli", "/alis/hizli", "/restoran/satis", ...TICKET_PAGES],
    writePages: ["/ayarlar/fis-tasarim"],
  },
]

// En uzun ön ek kazansın: "/api/cari/customers" kuralı "/api/cari"den önce denenmeli.
const RULES_BY_SPECIFICITY = [...PAGE_API_RULES].sort((a, b) => b.prefix.length - a.prefix.length)

/** Yol bir sayfa kuralına giriyorsa onu döndürür, yoksa null (kapıya tabi değil). */
export function pageRuleForApiPath(pathname: string): PageApiRule | null {
  for (const rule of RULES_BY_SPECIFICITY) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix + "/")) return rule
    // "/api/export/rapor-" gibi segment ortasında biten ön ekler için düz startsWith.
    if (rule.prefix.endsWith("-") && pathname.startsWith(rule.prefix)) return rule
  }
  return null
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/** İstek yazma mı? (bilinmeyen metot yazma sayılır — fail closed) */
export function isWriteRequest(method: string): boolean {
  return !READ_METHODS.has(method.toUpperCase())
}

/**
 * Üyelik kısıtlı mı?
 *
 * Özel rol HER ZAMAN kısıtlıdır — listesi ne kadar geniş olursa olsun yetkisi
 * açıkça sayılmış sayfalardan ibarettir. Hazır rollerde ise boş liste "kısıt yok"
 * demektir (bugünkü herkesin hâli).
 */
export function isRestrictedMembership(permissions: PagePermissions): boolean {
  return isCustomRole(permissions) || permissions.allowedPaths.length > 0
}

/**
 * Bu üyeliğin yetki TAVANI: özel rolde yönetim-dışı her sayfa, aksi halde rol matrisi.
 *
 * `role === "CUSTOM"` tek başına yeterlidir; `custom` bayrağı beklenmez. Bayrağı
 * taşımayı unutan bir çağıran (bir kez oldu: istemci provider'ı) TAVANI
 * `pagesForRole("CUSTOM")` ile hesaplardı ve o BOŞ KÜMEDİR — hiçbir sayfa `roles`
 * listesinde CUSTOM taşımaz. Sonuç: özel rollü kullanıcı her sayfada "yetkiniz yok"
 * görürdü. Enum değeri zaten gerçeğin kaynağı, ona da bakılıyor.
 */
export function isCustomRole(permissions: PagePermissions): boolean {
  return Boolean(permissions.custom) || permissions.role === "CUSTOM"
}

export function ceilingPages(permissions: PagePermissions): string[] {
  return isCustomRole(permissions) ? assignablePages() : pagesForRole(permissions.role)
}

/**
 * Kullanıcının GERÇEKTEN görebildiği sayfalar: tavan ∩ allowedPaths.
 *
 * Kesişim tek yönlüdür — allowedPaths'e yazılmış ama tavanda olmayan bir sayfa
 * sonuca GİRMEZ. Kişisel sayfalar (profil, destek) her hâlükârda eklenir; kimse
 * kendi profiline kapatılamamalı.
 */
export function visiblePages(permissions: PagePermissions): string[] {
  const ceiling = ceilingPages(permissions)
  if (!isRestrictedMembership(permissions)) return ceiling
  const allowed = new Set([...permissions.allowedPaths, ...ALWAYS_AVAILABLE_PAGES])
  return ceiling.filter((href) => allowed.has(href))
}

/**
 * Yazılabilir sayfalar: görülebilir sayfalar ∩ writablePaths.
 *
 * Kısıt yokken yazma kararı role aittir (bugünkü davranış) — tüm görünür sayfalar
 * yazılabilir sayılır. VIEWER'ın salt-okunurluğu ayrı bir kapıdır, bkz.
 * `ensureCompanyWrite`.
 */
export function editablePages(permissions: PagePermissions): string[] {
  const visible = visiblePages(permissions)
  if (!isRestrictedMembership(permissions)) return visible
  const writable = new Set(permissions.writablePaths)
  return visible.filter((href) => writable.has(href))
}

export function canViewPage(permissions: PagePermissions, href: string): boolean {
  return visiblePages(permissions).includes(href)
}

export function canEditPage(permissions: PagePermissions, href: string): boolean {
  return editablePages(permissions).includes(href)
}

/**
 * İstek, kullanıcının izinli sayfalarıyla bu ucu kullanabiliyor mu?
 *
 * Kuralı olmayan yol her zaman geçer; kuralı olan yol için gereken sayfalardan EN AZ
 * BİRİ izinli olmalıdır (module-access'teki "herhangi biri açıksa geçer" ile aynı
 * mantık — bir uç birden çok ekranın ihtiyacıdır).
 */
export function isApiPathAllowedForUser(
  pathname: string,
  method: string,
  permissions: PagePermissions
): boolean {
  if (!isRestrictedMembership(permissions) && !ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED) return true

  const rule = pageRuleForApiPath(pathname)
  if (!rule) return true

  const required = isWriteRequest(method) ? rule.writePages ?? rule.pages : rule.pages
  const granted = new Set(isWriteRequest(method) ? editablePages(permissions) : visiblePages(permissions))
  return required.some((href) => granted.has(href))
}

/** 403 gövdesinde ve logda kullanılacak sayfa listesi (ucun gerektirdikleri). */
export function requiredPagesForApiPath(pathname: string, method: string): string[] {
  const rule = pageRuleForApiPath(pathname)
  if (!rule) return []
  return isWriteRequest(method) ? rule.writePages ?? rule.pages : rule.pages
}

/**
 * Panel içindeki GERÇEK bir route'un hangi menü öğesine ait olduğunu çözer.
 *
 * Gerekli çünkü menü href'i ile gezilen adres çoğu yerde aynı değil: "Müşteri"
 * öğesinin href'i `/cari/musteri` ama liste `/cari`de, detay `/cari/customers/[id]`de
 * yaşıyor. İzin listesi menü href'lerini sakladığı için sayfa kapısı bu çeviriye
 * muhtaç.
 *
 * Birden çok sahip dönebilir (fatura önizlemesi hem satış hem alış faturasına ait
 * olabilir); çağıran taraf "herhangi biri izinliyse geçer" uygular.
 */
export function navHrefsForPath(pathname: string, search?: URLSearchParams | null): string[] {
  // Cari ağacı: segment (`/cari/customers/*`) ya da `?tab=` belirler.
  const cari = cariActiveHref(pathname, search)
  if (cari) return [cari]
  if (pathname === "/cari" || pathname.startsWith("/cari/")) {
    return ["/cari/musteri", "/cari/tedarikci"]
  }

  for (const [prefix, owners] of Object.entries(ROUTE_OWNERS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return owners
  }

  // Menü öğesinin kendisi ya da alt yolu (örn. /personel/123 → /personel).
  // En SPESİFİK (en uzun) eşleşme kazanır, aksi halde /personel tüm kardeşlerini yutar.
  let best: string | null = null
  for (const href of ALL_NAV_HREFS) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.length) best = href
    }
  }
  return best ? [best] : []
}

/**
 * Menüde karşılığı olmayan route'ların sahibi.
 *
 * Buraya girmeyen ve hiçbir nav href'ine düşmeyen sayfa KAPIYA TABİ DEĞİLDİR
 * (muhasebe fişleri, bilanço/kâr-zarar gibi menüsüz raporlar, /ayarlar/audit,
 * /companies/*). Bunlar menüden erişilemiyor ve yanlış eşlenirse çalışan bir ekranı
 * kırardı; bilinçli boşluk olarak bırakıldı.
 */
const ROUTE_OWNERS: Record<string, string[]> = {
  "/stok/receteler": ["/restoran/menu"],
  "/stok": ["/stok/urunler"],
  "/depolar/transfer": ["/stok/transfer"],
  "/banka/mutabakat": ["/finans/mutabakat"],
  "/finans": ["/finans/hareketler"],
  "/kasa": ["/finans/kanallar"],
  "/cek-senet": ["/cek-senet/cek", "/cek-senet/senet"],
  "/e-irsaliye": ["/satis/irsaliye"],
  // e-Fatura oluşturma/görüntüleme ekranı menüde yok; satış faturasından girilir.
  "/e-donusum/yeni": ["/satis/fatura"],
  "/faturalar": ["/satis/fatura", "/alis/fatura"],
  "/fisler": ["/satis/fisler", "/alis/fisler"],
  "/raporlar/nakit-akisi": ["/raporlar/nakit-banka"],
  "/raporlar/cari-yaslandirma": ["/raporlar/cari"],
  "/raporlar/vergiler": ["/raporlar/vergi"],
  "/restoran/adisyon": TICKET_PAGES,
  "/restoran/gun-sonu": ["/restoran/raporlar"],
  "/restoran/karlilik": ["/restoran/raporlar"],
  "/restoran/menu-performans": ["/restoran/raporlar"],
  "/restoran/tuketim": ["/restoran/raporlar"],
}

/** Kullanıcı bu panel route'unu açabilir mi? (sahibi yoksa kapıya tabi değil) */
export function canAccessRoute(
  permissions: PagePermissions,
  pathname: string,
  search?: URLSearchParams | null
): boolean {
  if (!isRestrictedMembership(permissions) && !ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED) return true
  const owners = navHrefsForPath(pathname, search)
  if (owners.length === 0) return true
  const granted = new Set(visiblePages(permissions))
  return owners.some((href) => granted.has(href))
}

/**
 * Arayüzden gelen izin seçimini DB'ye yazılabilir hâle getirir.
 *
 * Üç şeyi garantiler:
 *  1. Yalnız gerçek menü sayfaları saklanır (bilinmeyen href atılır).
 *  2. Kesişim burada da uygulanır — rolün görmediği sayfa listeye girmez. Böylece
 *     `visiblePages` ile DB tutarlı kalır ve arayüz atlansa bile kural bozulmaz.
 *  3. Yazma listesi görüntüleme listesinin alt kümesidir.
 *
 * TÜM sayfalar tam yetkiyle seçilmişse liste BOŞALTILIR, yani "kısıt yok" olarak
 * saklanır. Aksi halde o üyelik dondurulmuş bir sayfa listesine kilitlenir ve panele
 * sonradan eklenen her sayfa ondan sessizce gizlenirdi.
 */
export function sanitizePagePermissions(
  role: string,
  allowedInput: unknown,
  writableInput: unknown,
  options?: { custom?: boolean }
): { allowedPaths: string[]; writablePaths: string[] } {
  const rolePages = ceilingPages({
    role,
    allowedPaths: [],
    writablePaths: [],
    custom: options?.custom,
  })
  const roleSet = new Set(rolePages)

  const clean = (input: unknown) =>
    Array.isArray(input)
      ? Array.from(new Set(input.filter((h): h is string => typeof h === "string" && roleSet.has(h))))
      : []

  const allowedPaths = clean(allowedInput)
  if (allowedPaths.length === 0) return { allowedPaths: [], writablePaths: [] }

  const allowedSet = new Set(allowedPaths)
  const writablePaths = clean(writableInput).filter((h) => allowedSet.has(h))

  // "Hepsi seçili + hepsi yazılabilir" yalnız HAZIR rollerde kısıtsıza çevrilir.
  // Özel rolde çevrilemez: özel rolün yetkisi tanımı gereği açıkça sayılmış sayfalardır,
  // listeyi boşaltmak onu "yetkisiz" yapardı — tam tersi anlam.
  const coversEverything =
    !options?.custom &&
    allowedPaths.length === rolePages.length &&
    writablePaths.length === rolePages.length
  if (coversEverything) return { allowedPaths: [], writablePaths: [] }

  return { allowedPaths, writablePaths }
}

/**
 * Kullanıcının açılışta düşeceği sayfa.
 *
 * Kısıtsız kullanıcı bugünkü gibi rolünün panosuna gider. Kısıtlı çalışan için bu
 * YANLIŞ olurdu: rol panosu ciro, müşteri sayısı ve kâr gibi rakamlar basıyor —
 * "yalnız müşterileri görsün" denen kişi daha ilk ekranda hepsini görürdü. Panoya
 * izni yoksa ilk izinli sayfasına düşer.
 *
 * Hiç izinli sayfası kalmamışsa (rolü daralmış ya da liste geçersiz kalmış) profil
 * sayfası son çare: her rolde açık ve rakam basmıyor.
 */
export function landingPathFor(permissions: PagePermissions): string {
  if (!isRestrictedMembership(permissions)) return roleToDashboardPath(permissions.role)
  const visible = visiblePages(permissions)
  if (visible.includes("/dashboard")) return roleToDashboardPath(permissions.role)
  // Kişisel sayfalar (profil/destek) her zaman izinli olduğu için listenin başına
  // düşebilir; açılışta onları göstermek "hiç yetkin yok" izlenimi verir. Önce
  // operasyonel bir sayfa ara, hiç yoksa profil — destek ekranı bir "ev" değil.
  const operational = visible.find((href) => !ALWAYS_AVAILABLE_PAGES.includes(href))
  return operational ?? "/ayarlar/profil"
}

/** 403 gövdesindeki makine-okunur kod; arayüz "yöneticinize başvurun" ekranını buna göre açar. */
export const PAGE_FORBIDDEN_CODE = "PAGE_FORBIDDEN"

const PAGE_FORBIDDEN_MESSAGE_RE = /Access denied: page not permitted \(([^)]*)\)/

/**
 * Sayfa kapısının fırlattığı hata.
 *
 * Mesaj bilerek `"Access denied"` ile BAŞLAR: route'ların çoğu 403'e maplemeyi bu
 * ifadeye bakarak yapıyor, dolayısıyla helper'a geçmemiş bir uçta da istek reddedilir.
 * `ModuleLockedError` ile aynı sözleşme (bkz. lib/module-access.ts).
 */
export class PageForbiddenError extends Error {
  readonly code = PAGE_FORBIDDEN_CODE
  readonly pages: string[]

  constructor(pages: string[]) {
    super(`Access denied: page not permitted (${pages.join("|")})`)
    this.name = "PageForbiddenError"
    this.pages = pages
  }
}

export function pageForbiddenFrom(error: unknown): PageForbiddenError | null {
  if (error instanceof PageForbiddenError) return error
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const match = PAGE_FORBIDDEN_MESSAGE_RE.exec(message)
  if (!match) return null
  return new PageForbiddenError(match[1] ? match[1].split("|").filter(Boolean) : [])
}
