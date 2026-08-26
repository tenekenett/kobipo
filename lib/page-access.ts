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
// KAPSAM: kapı TÜM üyeliklere uygulanır (2026-08-20'den beri; bkz.
// ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED). Kısıtsız bir üyelikte kesişimin izin
// tarafı boş olduğu için efektif izin rol matrisinin kendisidir — yani menüde
// olmayan bir ekranın ucu artık elle de çağrılamaz.

import {
  ALWAYS_AVAILABLE_PAGES,
  NAV_PAGES,
  assignablePages,
  cariActiveHref,
  filterAvailablePages,
  pagesForRole,
  type PageAvailability,
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
  /**
   * KİŞİSEL uç: üyeliğin izin listesinden bağımsız olarak herkese açıktır (okuma da
   * yazma da). Bildirimi okundu işaretlemek ya da destek talebi açmak bir "ekran
   * yetkisi" değildir; kısıtlı çalışanın da hakkıdır. `pages` yine yazılır — hangi
   * ekranın kullandığını belgelemek için — ama karar `personal` ile verilir.
   */
  personal?: true
}

/**
 * Rol matrisi kısıtsız kullanıcılara da uygulansın mı?
 *
 * ARTIK true (2026-08-20). Bu, güvenlik taramasındaki "çapraz-modül yazma matrisi"
 * bulgusunu kapatır: rol matrisi (`lib/nav/pages.ts` → `roles`) bugüne kadar YALNIZCA
 * menüyü çiziyordu; SALES rolü stok ekranını görmüyordu ama `/api/stok/*` ucunu elle
 * çağırabiliyordu. Artık menü ne diyorsa uç da onu diyor.
 *
 * Açmadan önce etki ÖLÇÜLDÜ (tahmin edilmedi): 194 kapılı ucun her metodu × 6 enum rol
 * taranıp "rolün gördüğü bir ekran, kapanacak bir ucu çağırıyor mu" sorusu soruldu.
 * Sonuç: ADMIN, BRANCH_MANAGER ve VIEWER'da sıfır; ACCOUNTANT'ta çıkan üç aday da
 * yanlış pozitifti. Gerçek etki STOCK ve SALES'te altı çağrıydı; ikisi haritaya
 * eklendi (aşağıda `/api/e-donusum/invoices` → `/alis/irsaliye` ve
 * `/api/company/definitions` yazma listesi), cari kartı açma ise bilinçle dar
 * bırakılıp arayüzde gizlendi (`useCanCreateCari`).
 *
 * Kısıtlı üyelikler (allowedPaths dolu) için kapı zaten HER HÂLÜKÂRDA çalışıyordu;
 * bayrak yalnız "kısıtsız" üyeliklerin de matrise tabi olmasını sağlar.
 */
export const ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED = true

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
    // Salt okuma ucu (yalnız GET var).
    writePages: [],
  },
  {
    prefix: "/api/cari/ekstre",
    pages: ["/cari/musteri", "/cari/tedarikci", "/raporlar/cari"],
    writePages: [],
  },
  {
    // Jenerik ön ek: cari YAZMALARININ tamamı /customers ve /suppliers altında ve
    // onların kendi kuralları var. Buraya düşen yol okumadır — rapor ekranı da
    // listede olduğu için yazmayı açık bırakmak "raporu gören cariyi siler" demekti.
    prefix: "/api/cari",
    pages: ["/cari/musteri", "/cari/tedarikci", "/raporlar/cari"],
    writePages: [],
  },

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
    // Tahsilat/ödeme KAYDEDEN ekranlar: fatura ödeme sayfası (sahibi satış/alış
    // faturası) ve hızlı satış/alış. Restoran adisyonu kendi ucundan kapanır
    // (/api/restoran/adisyonlar/[id]/kapat), finans hareketleri de buraya yazmaz —
    // ikisi de yalnız okur.
    writePages: ["/satis/fatura", "/alis/fatura", "/satis/hizli", "/alis/hizli"],
  },
  {
    prefix: "/api/faturalar",
    // Rapor ekranları BURAYI okumaz — kendi uçları var (/api/raporlar/*, /api/export/rapor-*)
    // ve fatura listesini `/api/e-donusum/invoices` üzerinden alırlar. Rapor sayfalarını
    // buraya eklemek, "yalnız satış raporu" izni olan birine ham fatura listesini açardı.
    pages: ["/satis/fatura", "/alis/fatura"],
    writePages: ["/satis/fatura", "/alis/fatura"],
  },
  {
    prefix: "/api/irsaliye",
    pages: ["/satis/irsaliye", "/alis/irsaliye"],
    writePages: ["/satis/irsaliye", "/alis/irsaliye"],
  },
  {
    // e-İrsaliye GİDEN belgedir: alış irsaliyesi ekranı listeyi okur ama göndermez.
    prefix: "/api/e-irsaliye",
    pages: ["/satis/irsaliye", "/alis/irsaliye"],
    writePages: ["/satis/irsaliye"],
  },
  {
    prefix: "/api/siparis",
    pages: ["/satis/siparis", "/alis/siparis"],
    writePages: ["/satis/siparis", "/alis/siparis"],
  },
  {
    prefix: "/api/teklif",
    pages: ["/teklif", "/alis/teklif"],
    writePages: ["/teklif", "/alis/teklif"],
  },
  {
    prefix: "/api/fisler",
    pages: ["/satis/fisler", "/alis/fisler", "/cari/musteri", "/cari/tedarikci"],
    writePages: ["/satis/fisler", "/alis/fisler"],
  },

  // ---- Stok / depo -------------------------------------------------------
  {
    prefix: "/api/stok/movements",
    pages: ["/raporlar/stok", "/stok/urunler", "/satis/fatura", "/alis/fatura"],
    // Hareketi ürün ekranı (elle düzeltme) ve fatura editörü (belge kaydı) yazar.
    // Stok RAPORU yazmaz — kural yokken "raporu gören stok hareketi girer"di.
    writePages: ["/stok/urunler", "/satis/fatura", "/alis/fatura"],
  },
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
  {
    prefix: "/api/depolar/transfer",
    pages: ["/stok/transfer", "/depolar"],
    // Transferi yalnız transfer ekranı oluşturur; depo listesi sonucu okur.
    writePages: ["/stok/transfer"],
  },
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
    // Salt okuma: depo bazlı stok seviyesi (yalnız GET var).
    writePages: [],
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
  {
    // Jenerik ön ek: finans yazmalarının tamamı /accounts ve /transactions altında,
    // ikisinin de kendi kuralı var. Buraya düşen yol okumadır.
    prefix: "/api/finans",
    pages: ["/finans/kanallar", "/finans/hareketler", "/finans/mutabakat"],
    writePages: [],
  },
  {
    // Tek yazma yolu kasa devri (/api/kasa/devir) ve onu kanal ekranı çalıştırır.
    prefix: "/api/kasa",
    pages: ["/finans/kanallar", "/finans/hareketler"],
    writePages: ["/finans/kanallar"],
  },
  {
    // Banka mutabakat eşleştirmesini yalnız mutabakat ekranı yazar.
    prefix: "/api/banka",
    pages: ["/finans/mutabakat", "/finans/kanallar", "/finans/hareketler"],
    writePages: ["/finans/mutabakat"],
  },
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
  // Rapor uçlarının TAMAMI salt okumadır (hiçbirinde GET dışı metot yok), bu yüzden
  // hepsinde `writePages: []`. Kural yokken `writePages ?? pages` devreye giriyor ve
  // "raporu görebilen rapor ucuna yazabilir" gibi anlamsız ama açık bir kapı
  // kalıyordu; ileride bir rapor ucuna yanlışlıkla POST eklenirse de kapalı doğar.
  { prefix: "/api/raporlar/personel", pages: ["/raporlar/personel", "/personel/puantaj"], writePages: [] },
  { prefix: "/api/raporlar/nakit-akisi", pages: ["/raporlar/nakit-banka"], writePages: [] },
  { prefix: "/api/raporlar/cari-yaslandirma", pages: ["/raporlar/cari"], writePages: [] },
  { prefix: "/api/raporlar/ba-bs", pages: ["/raporlar/vergi"], writePages: [] },
  { prefix: "/api/raporlar/kdv", pages: ["/raporlar/vergi"], writePages: [] },
  { prefix: "/api/raporlar/muhtasar", pages: ["/raporlar/vergi"], writePages: [] },
  // Mali tablolar. Menüde kendi öğeleri yok (/raporlar/bilanco, /raporlar/kar-zarar
  // adreslerinden açılıyorlar), o yüzden genel `/api/raporlar` kuralına düşüyorlardı —
  // yani "yalnız Satış Raporları" izni olan biri kâr-zararı okuyabiliyordu. Firmanın
  // bütününü gösterdikleri için finansal rapor öğelerine bağlandılar.
  { prefix: "/api/raporlar/kar-zarar", pages: ["/raporlar/nakit-banka", "/raporlar/vergi"], writePages: [] },
  { prefix: "/api/raporlar/bilanco", pages: ["/raporlar/nakit-banka", "/raporlar/vergi"], writePages: [] },
  { prefix: "/api/raporlar/gelir-gider", pages: ["/raporlar/nakit-banka", "/raporlar/vergi"], writePages: [] },
  { prefix: "/api/raporlar", pages: REPORT_PAGES, writePages: [] },

  // Muhasebe defterleri (yevmiye, kebir, hesap planı). Ekranları menüde YOK —
  // mali tablolardan link veriliyor — ve 2026-08-20'ye kadar hiç kuralları yoktu:
  // "kuralsız uç" varsayılanına düşüp okumada herkese açık, yazmada herkese kapalı
  // kalıyorlardı. Sessiz bir muafiyet yerine SÖZLEŞMEYİ AÇIK yazmak doğrusu:
  // defteri okumak mali tabloları okumakla aynı yetkidir, YAZMA ise hiçbir sayfaya
  // bağlı değildir (`writePages: []`) — fiş kesme arayüzden yapılmıyor.
  //
  // Muhasebe menüye alınırsa: `NAV_PAGES`'e sayfayı ekleyip `pages`/`writePages`'i
  // ona bağlayın; kuralı silmeyin.
  {
    prefix: "/api/muhasebe",
    // Defteri OKUMAK mali tabloları okumakla aynı yetkidir; defterin kendi katalog
    // sayfaları da listede (menüde görünmeseler de role verilebiliyorlar).
    pages: ["/muhasebe/yevmiye", "/muhasebe/kebir", "/raporlar/nakit-banka", "/raporlar/vergi"],
    // YAZMA yalnız defter sayfalarına bağlı: "kâr-zararı gören yevmiye fişi keser"
    // olmasın. Bugün arayüzden hiç POST yapılmıyor, ama sözleşme yazılı durur.
    writePages: ["/muhasebe/yevmiye", "/muhasebe/kebir"],
  },

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
  { prefix: "/api/personel/shift-templates", pages: ["/personel/vardiya"], writePages: ["/personel/vardiya"] },
  { prefix: "/api/personel/holidays", pages: ["/personel/vardiya"], writePages: ["/personel/vardiya"] },
  { prefix: "/api/personel/opening-hours", pages: ["/personel/vardiya"], writePages: ["/personel/vardiya"] },
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
  {
    // Jenerik ön ek: personel yazmalarının tamamı (bordro, vardiya, izin, zimmet,
    // özlük, çalışan) kendi kurallarının altında. Buraya düşen yol okumadır — aksi
    // halde "yalnız puantaj" izni olan biri bordro dışındaki her şeyi yazabilirdi.
    prefix: "/api/personel",
    pages: PERSONNEL_PAGES,
    writePages: [],
  },

  // ---- Restoran & Kafe ---------------------------------------------------
  { prefix: "/api/restoran/raporlar", pages: ["/restoran/raporlar"], writePages: [] },
  {
    prefix: "/api/restoran/kontrol-listesi",
    // Listeyi KURAN ekran ayrı, TİK ATAN ekran ayrı: personel maddeleri satış
    // ekranındaki uyarı şeridinden onaylar (bkz. lib/nav/pages.ts). Yazma listesi
    // bu yüzden satış/masa ekranlarını da içerir.
    pages: ["/restoran/kontrol-listesi", "/restoran/satis", ...TICKET_PAGES, "/restoran/raporlar"],
    writePages: ["/restoran/kontrol-listesi", "/restoran/satis", ...TICKET_PAGES],
  },
  {
    // Adisyon açma/kalem ekleme/kapatma: kroki, masa listesi, adisyon ekranı ve
    // kahveci satış ekranı. Restoran RAPORLARI yalnız okur.
    prefix: "/api/restoran/adisyonlar",
    pages: [...TICKET_PAGES, "/restoran/satis", "/restoran/raporlar"],
    writePages: [...TICKET_PAGES, "/restoran/satis"],
  },
  {
    // Masa tanımı krokiden yönetilir; masa AÇMA (durum değişimi) satış ve masa
    // listesi ekranlarından da yapılır — ikisi de yazar.
    prefix: "/api/restoran/masalar",
    pages: [...TICKET_PAGES, "/restoran/satis"],
    writePages: [...TICKET_PAGES, "/restoran/satis"],
  },
  {
    // Bölgeyi (salon/teras) yalnız kroki ekranı tanımlar; menü ve masa listesi okur.
    prefix: "/api/restoran/bolgeler",
    pages: [...TICKET_PAGES, "/restoran/menu"],
    writePages: ["/restoran/masalar"],
  },
  { prefix: "/api/restoran/plan", pages: ["/restoran/masalar"], writePages: ["/restoran/masalar"] },
  {
    prefix: "/api/restoran/rezervasyonlar",
    pages: ["/restoran/masalar", "/restoran/masa-listesi"],
    writePages: ["/restoran/masalar", "/restoran/masa-listesi"],
  },
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
  {
    // İkram/zayi stoktan DÜŞER, yani gerçek bir yazmadır: satış ekranı ve adisyon
    // ekranlarının ikisi de kaydeder.
    prefix: "/api/restoran/ikram",
    pages: ["/restoran/satis", ...TICKET_PAGES],
    writePages: ["/restoran/satis", ...TICKET_PAGES],
  },
  {
    // Tavanı iskonto diyaloğu da OKUR (kasiyer sınırı görsün, "Uygula" boşuna
    // hata almasın); YAZMA ayarın yaşadığı rapor ekranına bağlıdır. Ucun kendi
    // içinde ayrıca ADMIN şartı var — bu kural sayfa kapısının payına düşen.
    prefix: "/api/restoran/iskonto-limiti",
    pages: ["/restoran/raporlar", "/restoran/satis", ...TICKET_PAGES],
    writePages: ["/restoran/raporlar"],
  },
  {
    // Jenerik ön ek: restoran yazmalarının tamamı (adisyon, masa, bölge, kroki,
    // rezervasyon, reçete, ürün seçenekleri, ikram, kontrol listesi, iskonto limiti)
    // kendi kurallarının altında. Buraya düşen yol okumadır.
    prefix: "/api/restoran",
    pages: RESTAURANT_PAGES,
    writePages: [],
  },

  // ---- E-Dönüşüm ---------------------------------------------------------
  // Yalnızca BELGE uçları kapıya tabi. VKN sorgusu, vergi/tevkifat kod listeleri ve
  // onboarding gibi yardımcı uçlar kuralsız bırakıldı: bunlar firma ayarının parçası,
  // hangi ekranın açık olduğuyla ilgisi yok.
  {
    // Gelen kutusu eylemleri (kabul/ret/faturaya dönüştür) hem gelen e-fatura
    // ekranından hem fatura listelerinden tetikleniyor.
    prefix: "/api/e-donusum/inbox",
    pages: ["/alis/gelen-e-faturalar", "/alis/fatura", "/satis/fatura"],
    writePages: ["/alis/gelen-e-faturalar", "/alis/fatura", "/satis/fatura"],
  },
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
      // Alış irsaliyesini bir alış faturasına BAĞLARKEN aday fatura listesini okur
      // (`?type=PURCHASE`). Yalnız okuma: irsaliye ekranı fatura yazmaz, bağlar.
      "/alis/irsaliye",
    ],
    writePages: ["/satis/fatura", "/alis/fatura", "/satis/hizli", "/alis/hizli"],
  },
  // Şablonu tasarımcı ekranı yazar; seri numaratörlerini hem seri-no ekranı hem
  // tasarımcı (şablona seri bağlarken) yazar.
  { prefix: "/api/e-donusum/templates", pages: ["/e-donusum/sablon", "/e-donusum/seri-no"], writePages: ["/e-donusum/sablon"] },
  {
    prefix: "/api/e-donusum/series-templates",
    pages: ["/e-donusum/sablon", "/e-donusum/seri-no"],
    writePages: ["/e-donusum/sablon", "/e-donusum/seri-no"],
  },
  {
    prefix: "/api/e-donusum/numerators",
    pages: ["/e-donusum/sablon", "/e-donusum/seri-no"],
    writePages: ["/e-donusum/sablon", "/e-donusum/seri-no"],
  },

  // ---- Dışa/içe aktarma --------------------------------------------------
  // Kapalı sayfanın verisi export'tan sızmasın. Dataset adı yolun parçası olduğu için
  // ön ek eşleşmesi burada da çalışır (bkz. module-access.ts'teki aynı desen).
  // Export uçlarının tamamı salt okumadır (üçünde de yalnız GET var): dosya üretir,
  // veri değiştirmez. `writePages: []` ile bu sözleşme kural tarafında da yazılı.
  { prefix: "/api/export/rapor-personel", pages: ["/raporlar/personel"], writePages: [] },
  { prefix: "/api/export/rapor-", pages: REPORT_PAGES, writePages: [] },
  { prefix: "/api/export/personel-", pages: [...PERSONNEL_PAGES, "/raporlar/personel"], writePages: [] },
  {
    prefix: "/api/export/products",
    pages: ["/stok/urunler", "/stok/hizmetler", "/ayarlar/veri-aktarim"],
    writePages: [],
  },
  {
    prefix: "/api/export/invoices",
    pages: ["/satis/fatura", "/alis/fatura", "/ayarlar/veri-aktarim"],
    writePages: [],
  },
  {
    prefix: "/api/export/cari",
    pages: ["/cari/musteri", "/cari/tedarikci", "/ayarlar/veri-aktarim"],
    writePages: [],
  },
  { prefix: "/api/export/ekstre", pages: ["/cari/musteri", "/cari/tedarikci"], writePages: [] },
  { prefix: "/api/export/accountant", pages: ["/ayarlar/veri-aktarim"], writePages: [] },
  // İçe aktarma export'un tersi: veriyi GERÇEKTEN yazar, sahibi tek ekrandır.
  { prefix: "/api/import", pages: ["/ayarlar/veri-aktarim"], writePages: ["/ayarlar/veri-aktarim"] },

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
    // Tanım listesi (ürün kategorisi gibi) ekranın KENDİ kavramıdır: ürün kartını
    // açan combobox ve kategori yöneticisi onu satır içinde üretir. Yazmayı yalnız
    // "/ayarlar/tanimlar"a bağlamak, o ekranı görmeyen bir role satır içi kategori
    // eklemeyi 403'e çevirirdi — düğme dururken. Liste, kategoriyi GERÇEKTEN üreten
    // ekranlardır: satır içi combobox (hızlı satış/alış + fatura düzenleyici) ve
    // kategori yöneticisi (stok kartları, restoran menüsü).
    writePages: [
      "/ayarlar/tanimlar",
      "/stok/urunler",
      "/restoran/menu",
      "/satis/fatura",
      "/alis/fatura",
      "/satis/hizli",
      "/alis/hizli",
    ],
  },
  {
    prefix: "/api/company/users",
    // Cari kartındaki "yetkili kullanıcı" seçicisi de ekip listesini okur.
    pages: ["/ayarlar/ekip", "/cari/musteri", "/cari/tedarikci"],
    writePages: ["/ayarlar/ekip"],
  },
  { prefix: "/api/company/invitations", pages: ["/ayarlar/ekip"], writePages: ["/ayarlar/ekip"] },
  // Rol tanımlama ucu. Route zaten enum ADMIN istiyor; buradaki kural ikinci kilittir
  // ve daha güçlüdür: "/ayarlar/roller" hiçbir özel role atanamadığı için (bkz.
  // ACCOUNT_ADMIN_PAGES) bu uç özel rol taşıyan bir üyelikte ASLA açılamaz.
  { prefix: "/api/company/roles", pages: ["/ayarlar/roller"], writePages: ["/ayarlar/roller"] },
  {
    prefix: "/api/company/branch-managers",
    pages: ["/ayarlar/sube-mudurleri"],
    writePages: ["/ayarlar/sube-mudurleri"],
  },
  {
    prefix: "/api/fis-tasarim",
    pages: ["/ayarlar/fis-tasarim", "/satis/hizli", "/alis/hizli", "/restoran/satis", ...TICKET_PAGES],
    writePages: ["/ayarlar/fis-tasarim"],
  },

  // ---- Kişisel uçlar -----------------------------------------------------
  // Bunlar EKRAN yetkisine bağlanamaz: kısıtlı bir çalışan da bildirimini okundu
  // işaretleyebilmeli ve destek talebi açabilmelidir. Kural olarak yazılmalarının
  // sebebi, kuralsız uçların varsayılanının artık "yazma reddedilir" olması.
  { prefix: "/api/notifications", pages: ALWAYS_AVAILABLE_PAGES, personal: true },
  { prefix: "/api/support/tickets", pages: ["/ayarlar/destek"], personal: true },

  // ---- Menüsüz ama sahibi belli uçlar ------------------------------------
  // Fatura önizleme ekranından dosya eklenir; o ekranın sahibi satış/alış faturasıdır.
  {
    prefix: "/api/attachments",
    pages: ["/satis/fatura", "/alis/fatura"],
    writePages: ["/satis/fatura", "/alis/fatura"],
  },
  // e-Dönüşüm kurulum/keşif uçları: entegratör bağlantısını kuran ayar ekranına aittir.
  // Hepsi POST'tur ama "veri yazma" değil "ayar bağlama" işidir; yine de tek sahibi var.
  { prefix: "/api/e-donusum/onboarding", pages: ["/ayarlar/e-donusum"], writePages: ["/ayarlar/e-donusum"] },
  { prefix: "/api/e-donusum/discover-", pages: ["/ayarlar/e-donusum"], writePages: ["/ayarlar/e-donusum"] },
  { prefix: "/api/e-donusum/verify-tenant-vkn", pages: ["/ayarlar/e-donusum"], writePages: ["/ayarlar/e-donusum"] },
  { prefix: "/api/test-mysoft", pages: ["/ayarlar/e-donusum"], writePages: ["/ayarlar/e-donusum"] },
  // Kontör satın alma akışı (sipariş + PayTR token + makbuz) tek ekrandan yürür.
  { prefix: "/api/kontor/orders", pages: ["/e-donusum/kontor"], writePages: ["/e-donusum/kontor"] },
  // Abonelik ve firma yönetimi. Bu sayfalar ACCOUNT_ADMIN_PAGES üyesi olduğu için
  // hiçbir ÖZEL role atanamaz — kural, enum rolü kısıtlanmış yöneticiler içindir.
  { prefix: "/api/billing/orders", pages: ["/ayarlar/abonelik"], writePages: ["/ayarlar/abonelik"] },
  // İndirim kodu ÖN İZLEMESİ. POST'tur ama hiçbir şey yazmaz: kodu doğrulayıp
  // indirimli tutarı döner. Sahibi, kodu girebilen iki satın alma ekranıdır —
  // kodun kendisi sistem-admin panelinden yönetilir (o uç requireSuperAdmin ile
  // korunur, sayfa kapısına tabi değildir).
  {
    prefix: "/api/discount-codes",
    pages: ["/e-donusum/kontor", "/ayarlar/abonelik"],
    writePages: ["/e-donusum/kontor", "/ayarlar/abonelik"],
  },
  { prefix: "/api/billing/subscription", pages: ["/ayarlar/abonelik"], writePages: ["/ayarlar/abonelik"] },
  {
    prefix: "/api/companies",
    // Firma/şube kartını hem şube yönetimi hem firma bilgileri ekranı günceller.
    pages: ["/ayarlar/subeler", "/ayarlar/firma", "/ayarlar/sube-bilgileri"],
    writePages: ["/ayarlar/subeler", "/ayarlar/firma", "/ayarlar/sube-bilgileri"],
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
 * Sayfa kapısı bu üyeliğe uygulanır mı?
 *
 * Kapının kapsamını belirleyen TEK yordam. Sunucu kapısı (`assertPageAccess`) ile
 * uç kararı (`isApiPathAllowedForUser`) ayrı ayrı "kısıtlı mı?" diye sorsaydı,
 * bayrağı çevirmek ikisinden birini güncellemeyi unutmak demekti — kapı erken
 * dönerken uç kararının true sanması sessiz bir açık bırakırdı.
 */
export function isPageGateApplicable(permissions: PagePermissions): boolean {
  return ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED || isRestrictedMembership(permissions)
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
 * Enum rolün kendisi salt-okunur mu? Bugün yalnız VIEWER.
 *
 * Kısıt (allowedPaths) ile İLGİSİZDİR: VIEWER kısıtsız bir üyelikte de yazamaz. Ayrı
 * bir yordam olarak duruyor çünkü hem `editablePages` hem `ensureCompanyWrite` aynı
 * cevabı vermek zorunda — ikisi ayrışırsa ekran "düzenleyebilirsin" derken API 403
 * döner (ya da tersi, daha kötüsü).
 */
export function isReadOnlyRole(permissions: PagePermissions): boolean {
  return permissions.role === "VIEWER"
}

/**
 * Yazılabilir sayfalar: görülebilir sayfalar ∩ writablePaths.
 *
 * Kısıt yokken yazma kararı role aittir — tüm görünür sayfalar yazılabilir sayılır.
 * TEK İSTİSNA salt-okunur roldür: VIEWER kısıtsız sayıldığı için buradan eskiden
 * "her sayfada yazabilir" çıkıyordu ve arayüz tüm Kaydet/Sil düğmelerini ona da
 * çiziyordu. Sunucuda tek koruma `ensureCompanyWrite` idi; onu çağırmayan uçlarda
 * VIEWER gerçekten yazabiliyordu.
 */
export function editablePages(permissions: PagePermissions): string[] {
  if (isReadOnlyRole(permissions)) return []
  const visible = visiblePages(permissions)
  if (!isRestrictedMembership(permissions)) return visible
  const writable = new Set(permissions.writablePaths)
  return visible.filter((href) => writable.has(href))
}

/**
 * Üyelik hiçbir sayfada yazamıyor mu?
 *
 * İki hâli birden kapsar: enum VIEWER ve "hepsi salt-okunur" tanımlanmış özel rol
 * (ör. Gözlemci kalıbı). İkincisinin enum'u CUSTOM'dur, yani VIEWER kontrolüne HİÇ
 * takılmaz — `ensureCompanyWrite` bu yüzden onu durduramıyordu.
 */
export function isReadOnlyMembership(permissions: PagePermissions): boolean {
  return editablePages(permissions).length === 0
}

export function canViewPage(permissions: PagePermissions, href: string): boolean {
  return visiblePages(permissions).includes(href)
}

export function canEditPage(permissions: PagePermissions, href: string): boolean {
  // Kişisel sayfalar (profil, destek talebi) herkese yazılabilir — kimse kendi
  // profilini düzenleyemez ya da destek isteyemez hâle gelmemeli. `editablePages`
  // bunları KAPSAMAZ: orası "iş" sayfalarının kümesidir ve `isReadOnlyMembership`
  // ona bakar; ikisini birleştirseydik hiçbir üyelik salt-okunur görünmezdi.
  if (ALWAYS_AVAILABLE_PAGES.includes(href)) return true
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
  if (!isPageGateApplicable(permissions)) return true

  const rule = pageRuleForApiPath(pathname)
  // Kişisel uç (bildirim, destek talebi) izin listesine bakmaz.
  if (rule?.personal) return true

  if (!rule) {
    // KURALSIZ UÇ: okuma serbest, YAZMA reddedilir.
    //
    // Eskiden ikisi de serbestti ve en büyük delik buydu: haritada karşılığı olmayan
    // her uç, kısıtlı bir çalışana sonuna kadar açıktı. Asimetri bilinçli — kuralı
    // unutulmuş bir okuma ucu ekranı kırar ve fark edilmez; unutulmuş bir YAZMA ucu
    // ise kısıtın kendisini anlamsız kılar. Yeni bir yazma ucu eklerken sahibini
    // PAGE_API_RULES'a yazın; yazmazsanız kısıtlı üyeliklerde kapalı doğar.
    return !isWriteRequest(method)
  }

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
  // Mali tablo EKRANLARI. Uçları (`/api/raporlar/bilanco`, `/kar-zarar`) zaten bu iki
  // rapor sayfasına bağlıydı; sayfanın kendisi bağlı olmadığı için izinsiz bir rol
  // adresi elle yazınca boş ama açık bir ekran görüyordu. Kapı artık veriyle aynı yeri
  // gösteriyor.
  "/raporlar/bilanco": ["/raporlar/nakit-banka", "/raporlar/vergi"],
  "/raporlar/kar-zarar": ["/raporlar/nakit-banka", "/raporlar/vergi"],
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
export function landingPathFor(
  permissions: PagePermissions,
  availability?: PageAvailability
): string {
  if (!isRestrictedMembership(permissions)) return roleToDashboardPath(permissions.role)
  // Kapalı modülün sayfası "ev" olamaz: kullanıcı açılışta doğrudan "bu modül
  // satın alınmamış" ekranına düşer ve elinde gidecek yer kalmaz.
  const visible = filterAvailablePages(visiblePages(permissions), availability)
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
