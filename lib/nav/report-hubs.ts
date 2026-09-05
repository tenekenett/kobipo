/**
 * Rapor hub sayfalarının içeriği — TEK kaynak.
 *
 * `/raporlar` ve `/raporlar/satis-alis` menüde yer almayan "kavşak" ekranlarıdır:
 * kendileri veri basmaz, başka rapor sayfalarına link verir. Menüsüz oldukları
 * için sayfa kapısına da tabi değiller (`navHrefsForPath` sahip bulamaz →
 * serbest); asıl karar linklerin gittiği sayfalarda verilir. Bu yüzden listeler
 * burada duruyor: üst hub, alt hub'ın linklerini görmeden "bu bölümde
 * kullanıcının açabileceği bir şey var mı" sorusunu yanıtlayamaz.
 *
 * `/raporlar/finansal` 2026-09-05'te bu kümeden ÇIKTI: artık kendi menü öğesi
 * olan ve rakam basan bir pano (mali tablolara tek erişim yolu üç tık ötedeki bu
 * kavşaktı, kullanıcı "mali tablo yok" sanıyordu). Link listesi burada kaldı
 * çünkü `/raporlar` hub'ı hâlâ aynı listeyi süzerek "bu bölümde açabileceği bir
 * şey var mı" diye soruyor.
 *
 * İkon BU DOSYADA YOK, `iconKey` var: liste sunucu tarafında da okunabilsin diye
 * (lucide bileşenlerini bundle'a çekmemek için `lib/nav/pages.ts` ile aynı ayrım).
 */

export type ReportHubLink = {
  title: string
  description: string
  /** Panel yolu — query'siz. Firma param'ı çizim anında eklenir. */
  href: string
}

export type ReportHub = ReportHubLink & {
  iconKey: "sales" | "financial" | "stock"
  /**
   * Bu bölümün altındaki rapor sayfaları. BOŞ dizi = hub değil, doğrudan bir rapor
   * sayfasına giden kısayol (ör. Stok Raporları); görünürlüğü kendi yoluna bakar.
   */
  links: ReportHubLink[]
}

const SATIS_ALIS_LINKS: ReportHubLink[] = [
  {
    title: "Vergi Beyannameleri",
    description: "KDV, Muhtasar ve Ba-Bs hazırlık raporlarını açar.",
    href: "/raporlar/vergiler",
  },
  {
    title: "Satış Faturaları",
    description: "Satış faturaları akışına hızlı geçiş sağlar.",
    href: "/satis/fatura",
  },
  {
    title: "Alış Faturaları",
    description: "Alış faturaları akışına hızlı geçiş sağlar.",
    href: "/alis/fatura",
  },
]

const FINANSAL_LINKS: ReportHubLink[] = [
  {
    title: "Gelir-Gider (Karlılık)",
    description: "Kategori, etiket ve cari kırılımıyla dönem kârlılığı.",
    href: "/raporlar/gelir-gider",
  },
  {
    title: "Harcamalar",
    description: "Gider kategorisi ağacı ve kalem kalem harcama defteri.",
    href: "/raporlar/harcamalar",
  },
  {
    title: "Kar/Zarar Tablosu",
    description: "Dönemsel gelir, gider ve net kar/zarar analizi.",
    href: "/raporlar/kar-zarar",
  },
  {
    title: "Bilanço",
    description: "Varlık, yükümlülük ve özsermaye görünümü.",
    href: "/raporlar/bilanco",
  },
  {
    title: "Nakit Akış Tablosu",
    description: "Nakit giriş-çıkış hareketlerinin dönemsel özeti.",
    href: "/raporlar/nakit-akisi",
  },
  {
    title: "Muhasebe / Yevmiye",
    description: "Muhasebe kayıt ekranına ve yevmiye görünümüne yönlendirir.",
    href: "/muhasebe/yevmiye",
  },
  {
    title: "Cari Yaşlandırma",
    description: "Müşteri ve tedarikçi bakiyelerini vade bazında analiz eder.",
    href: "/raporlar/cari-yaslandirma",
  },
  {
    title: "Cari Ekstre",
    description: "Cari hareket dökümü ve güncel bakiye detayını gösterir.",
    href: "/cari/ekstre",
  },
  {
    title: "Cari Hesaplar",
    description: "Müşteri ve tedarikçi listelerine hızlı erişim sağlar.",
    href: "/cari",
  },
]

export const REPORT_HUBS: ReportHub[] = [
  {
    title: "Satışlar - Alışlar",
    description: "Vergi ve satış/alış odaklı raporlara tek noktadan erişin.",
    href: "/raporlar/satis-alis",
    iconKey: "sales",
    links: SATIS_ALIS_LINKS,
  },
  {
    title: "Finansal Raporlar",
    description: "Dönem özeti, kar/zarar, bilanço ve nakit akış tabloları.",
    href: "/raporlar/finansal",
    iconKey: "financial",
    links: FINANSAL_LINKS,
  },
  {
    title: "Stok Raporları",
    description: "Stok görünümü ve stokla ilişkili detay rapor sayfalarına gidin.",
    href: "/raporlar/stok",
    iconKey: "stock",
    links: [],
  },
]

/** Hub'ın linkleri — bilinmeyen yol için boş dizi. */
export function reportHubLinks(href: string): ReportHubLink[] {
  return REPORT_HUBS.find((hub) => hub.href === href)?.links ?? []
}
