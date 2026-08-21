/**
 * Panel (dashboard) rotaları için Türkçe tarayıcı sekme başlığı çözümü.
 *
 * Panel sayfalarının çoğu Client Component olduğundan Next.js `metadata` export
 * edilemiyor; bu yüzden başlık, pathname'e göre burada merkezî olarak çözülür ve
 * {@link file://../../components/dashboard/dashboard-title.tsx DashboardTitle}
 * bileşeni tarafından `document.title`'a yazılır (`%s | Kobipo`).
 *
 * Kaynak: her rotanın kullanıcıya gösterdiği ana başlık (h1 / pageTitle / heading).
 * Bunlar sidebar etiketlerinden (nav-config) kasıtlı olarak farklı olabilir: sekme
 * başlığı sayfayı tam olarak tanımlar (ör. liste sayfaları çoğuldur), sidebar ise
 * kısa/tekildir. Yeni bir sayfa eklendiğinde buraya bir satır eklemek yeterlidir;
 * eşleşmeyen rotalar son segmentin biçimlendirilmiş haliyle makul bir başlık alır.
 */

/** Tam pathname -> başlık. Statik (dinamik segment içermeyen) rotalar. */
const STATIC_TITLES: Record<string, string> = {
  "/": "Panel",

  // Dashboard / genel
  "/dashboard": "Genel Bakış",
  "/dashboard/accountant": "Muhasebe Paneli",
  "/dashboard/admin": "Yönetici Paneli",
  "/dashboard/sales": "Satış Paneli",
  "/dashboard/stock": "Stok Paneli",
  "/dashboard/viewer": "Görüntüleme Paneli",
  "/companies/new": "Yeni Firma",
  "/companies/onboarding": "Firma Kurulumu",
  "/companies/onboarding/complete": "Kurulum Tamamlandı",

  // Satış
  "/satis/fatura": "Satış Faturaları",
  "/satis/fisler": "Satış Fişleri",
  "/satis/hizli": "Hızlı Satış",
  "/satis/irsaliye": "Satış İrsaliyeleri",
  "/satis/siparis": "Satış Siparişleri",
  "/teklif": "Teklifler",

  // Alış
  "/alis/fatura": "Alış Faturaları",
  "/alis/fisler": "Alış Fişleri",
  "/alis/gelen-e-faturalar": "Gelen E-Faturalar",
  "/alis/hizli": "Hızlı Alış",
  "/alis/irsaliye": "Alış İrsaliyeleri",
  "/alis/siparis": "Alış Siparişleri",
  "/alis/teklif": "Satın Alma Teklifleri",

  // Cari
  "/cari": "Cari Hesaplar",
  "/cari/musteri": "Müşteriler",
  "/cari/tedarikci": "Tedarikçiler",
  "/cari/ekstre": "Cari Ekstre",
  "/cari/customers": "Müşteriler",
  "/cari/suppliers": "Tedarikçiler",
  "/cari/customers/new": "Yeni Müşteri",
  "/cari/suppliers/new": "Yeni Tedarikçi",

  // Stok & depo
  "/stok": "Stok Yönetimi",
  "/stok/urunler": "Ürünler",
  "/stok/hizmetler": "Hizmetler",
  "/stok/transfer": "Stok Transferi",
  "/stok/etiket": "Etiket Tasarımcısı",
  "/stok/receteler": "Reçeteler",

  // Restoran & Kafe
  "/restoran/masalar": "Masalar",
  "/restoran/masa-listesi": "Masa Listesi",
  "/restoran/adisyonlar": "Adisyonlar",
  "/restoran/satis": "Kahveci Satış",
  "/restoran/menu": "Menü & Reçeteler",
  "/restoran/kontrol-listesi": "Kontrol Listesi",
  "/restoran/raporlar": "Restoran Raporları",
  // Eski adresler yönlendirme olarak duruyor; başlıkları da korunuyor ki
  // yönlendirme tamamlanana kadar sekmede boş/yanlış başlık görünmesin.
  "/restoran/karlilik": "Karlılık",
  "/restoran/menu-performans": "Menü Performansı",
  "/restoran/tuketim": "Hammadde Tüketimi",
  "/restoran/gun-sonu": "Gün Sonu",
  "/depolar": "Depolar",
  "/depolar/transfer": "Depo Transferleri",

  // Finans
  "/finans": "Finans Yönetimi",
  "/finans/hareketler": "Finans Hareketleri",
  "/finans/kanallar": "Finans Kanalları",
  "/finans/mutabakat": "Banka Mutabakatı",
  "/banka/mutabakat": "Banka Mutabakatı",
  "/cek-senet": "Çek ve Senet",
  "/cek-senet/cek": "Çek Portföyü",
  "/cek-senet/senet": "Senet Portföyü",
  "/kasa/devir": "Kasa Devir İşlemleri",

  // Belgeler
  "/e-irsaliye": "E-İrsaliye",

  // E-Dönüşüm
  "/e-donusum": "E-Dönüşüm",
  "/e-donusum/yeni": "Yeni Fatura",
  "/e-donusum/kontor": "Kontör",
  "/e-donusum/sablon": "Belge Şablonları",
  "/e-donusum/seri-no": "Seri No Tanımları",

  // Raporlar
  "/raporlar": "Raporlar",
  "/raporlar/satis": "Satış Raporları",
  "/raporlar/alis": "Alış Raporları",
  "/raporlar/satis-alis": "Satışlar - Alışlar",
  "/raporlar/cari": "Cari Yaşlandırma",
  "/raporlar/cari-yaslandirma": "Cari Yaşlandırma",
  "/raporlar/musteri": "Müşteri Raporları",
  "/raporlar/vergi": "Vergi Beyannameleri",
  "/raporlar/vergiler": "Vergi Beyannameleri",
  "/raporlar/nakit-banka": "Nakit ve Banka",
  "/raporlar/nakit-akisi": "Nakit Akış Tablosu",
  "/raporlar/stok": "Stok Raporu",
  "/raporlar/personel": "Personel Raporları",
  "/raporlar/bilanco": "Bilanço",
  "/raporlar/kar-zarar": "Kar/Zarar Tablosu",
  "/raporlar/finansal": "Finansal Raporlar",

  // Personel
  "/personel": "Personeller",
  "/personel/ik": "Personel Belge Dolabı",
  "/personel/izin": "İzin ve Devam",
  "/personel/maas": "Maaş ve Bordro",
  "/personel/puantaj": "Aylık Puantaj",
  "/personel/vardiya": "Vardiya Takvimi",
  "/personel/vardiya/kiosk": "Vardiya Kiosku",
  "/personel/zimmet": "Zimmet",

  // Muhasebe
  "/muhasebe/kebir": "Kebir Defteri",
  "/muhasebe/yevmiye": "Yevmiye Defteri",

  // Ayarlar
  "/ayarlar/abonelik": "Abonelik",
  "/ayarlar/audit": "Denetim Kayıtları",
  "/ayarlar/destek": "Destek",
  "/ayarlar/e-donusum": "E-Dönüşüm Ayarları",
  "/ayarlar/ekip": "Ekip Yönetimi",
  "/ayarlar/roller": "Rol Yetkileri",
  "/ayarlar/firma": "Firma Bilgileri",
  "/ayarlar/fis-tasarim": "Fiş Tasarımı",
  "/ayarlar/profil": "Profil ve Güvenlik",
  "/ayarlar/sube-bilgileri": "Şube Bilgileri",
  "/ayarlar/subeler": "Şube Yönetimi",
  "/ayarlar/sube-mudurleri": "Şube Müdürleri",
  "/ayarlar/tanimlar": "Tanımlar",
  "/ayarlar/veri-aktarim": "Veri Aktarımı",
}

/**
 * Dinamik rotalar: `:` ile başlayan segment herhangi bir değeri eşler.
 * Kalıplar spesifikliğe göre sıralanır (önce daha uzun, sonra daha çok literal
 * segment), böylece `/cari/customers/new` gibi statikler ve `/cari/customers/:id`
 * gibi tip-özel kalıplar, genel `/cari/:type/:id`'den önce eşleşir.
 */
const DYNAMIC_ENTRIES: Array<[pattern: string, title: string]> = [
  // Cari — müşteri/tedarikçi ayrımı korunur, bilinmeyen tip için genel fallback
  ["/cari/customers/:id/edit", "Müşteri Düzenle"],
  ["/cari/suppliers/:id/edit", "Tedarikçi Düzenle"],
  ["/cari/:type/:id/edit", "Cari Düzenle"],
  ["/cari/customers/:id", "Müşteri Detayı"],
  ["/cari/suppliers/:id", "Tedarikçi Detayı"],
  ["/cari/:type/:id", "Cari Detayı"],

  // Satış / teklif
  ["/teklif/:id", "Teklif Detayı"],

  // Alış
  ["/alis/gelen-e-faturalar/:uuid", "Gelen E-Fatura Detayı"],

  // Stok
  ["/stok/:id", "Ürün Detayı"],

  // Finans
  ["/finans/hareketler/:id", "Hareket Detayı"],
  ["/finans/kanallar/:id", "Kanal Detayı"],

  // Çek / senet
  ["/cek-senet/cek/:id", "Çek Detayı"],
  ["/cek-senet/senet/:id", "Senet Detayı"],

  // Faturalar
  ["/faturalar/:id/odemeler", "Fatura Ödemeleri"],
  ["/faturalar/:id/onizleme", "Fatura Önizleme"],
  ["/faturalar/:id/etiket", "Etiket Yazdır"],

  // Fişler
  ["/fisler/:id", "Fiş Detayı"],
  ["/fisler/:id/yazdir", "Fiş Yazdır"],

  // E-Dönüşüm
  ["/e-donusum/kontor/odeme/:id", "Kart ile Ödeme"],
  ["/e-donusum/:id/duzenle", "Fatura Düzenle"],
  ["/e-donusum/:id", "Fatura Detayı"],

  // Restoran & Kafe
  ["/restoran/adisyon/:id", "Adisyon"],

  // Personel
  ["/personel/:id", "Personel Detayı"],

  // Ayarlar
  ["/ayarlar/subeler/:id", "Şube Detayı"],
]

type DynamicMatcher = { segs: string[]; literals: number; title: string }

const DYNAMIC_MATCHERS: DynamicMatcher[] = DYNAMIC_ENTRIES.map(([pattern, title]) => {
  const segs = pattern.split("/").filter(Boolean)
  const literals = segs.filter((s) => !s.startsWith(":")).length
  return { segs, literals, title }
}).sort((a, b) => b.segs.length - a.segs.length || b.literals - a.literals)

function matchDynamic(segments: string[]): string | null {
  for (const m of DYNAMIC_MATCHERS) {
    if (m.segs.length !== segments.length) continue
    let ok = true
    for (let i = 0; i < m.segs.length; i++) {
      const pat = m.segs[i]
      if (pat.startsWith(":")) continue // wildcard
      if (pat !== segments[i]) {
        ok = false
        break
      }
    }
    if (ok) return m.title
  }
  return null
}

/** Query/hash'i at, sondaki eğik çizgileri temizle. */
function normalizePath(pathname: string): string {
  let p = pathname || "/"
  const cut = p.search(/[?#]/)
  if (cut >= 0) p = p.slice(0, cut)
  if (p.length > 1) p = p.replace(/\/+$/, "")
  return p || "/"
}

/** Bir yol segmentini okunaklı başlığa çevirir: "veri-aktarim" -> "Veri Aktarim". */
function prettifySegment(seg: string): string {
  return seg
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1) : w))
    .join(" ")
}

/**
 * Verilen panel pathname'i için Türkçe sekme başlığını döndürür ("| Kobipo" eki
 * DashboardTitle tarafından eklenir). Bilinmeyen rotalarda son anlamlı segmentten
 * makul bir başlık üretir; hiçbir şey bulunamazsa boş string döner.
 */
export function resolvePageTitle(pathname: string): string {
  const path = normalizePath(pathname)

  const staticTitle = STATIC_TITLES[path]
  if (staticTitle) return staticTitle

  const segments = path.split("/").filter(Boolean)
  const dynamicTitle = matchDynamic(segments)
  if (dynamicTitle) return dynamicTitle

  // Bilinmeyen rota: sayısal/uuid segmentleri atlayıp son anlamlı segmenti biçimlendir.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (/^\d+$/.test(seg)) continue
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) continue
    return prettifySegment(seg)
  }

  return ""
}
