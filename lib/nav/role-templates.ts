// Hazır rol KALIPLARI — firmanın sıfırdan başlamak zorunda kalmaması için hazır
// başlangıç noktaları ("Hazır kalıplar" kartları).
//
// Kalıp bir BAĞ değil, bir KOPYADIR: firma kalıptan rol ürettiğinde sayfalar o rolün
// içine yazılır ve kalıp sonradan değişse bile rol değişmez. Aksi halde bir katalog
// güncellemesi, müşterinin elleyip özelleştirdiği rolü sessizce genişletir/daraltırdı.
//
// KATALOĞUN KAYNAĞI ARTIK VERİTABANI (`role_templates`), sistem yönetim panelinden
// düzenlenir: /system-admin/roller. Buradaki liste iki işe yarar:
//   1. migrasyonun tohumladığı ilk yedi kalıbın kod içindeki karşılığı
//      (supabase/migrations/20260821000001_role_templates.sql — aynı anahtarlar),
//   2. tablo henüz yokken (migrasyon uygulanmadan çıkılan sürüm) devreye giren yedek.
// Kalıp EKLEMEK/DÜZENLEMEK için burayı değil paneli kullanın; buraya yazılan bir
// değişiklik yalnız tohumlanmamış kurulumlarda görünür.
//
// Buradaki hiçbir kalıp hesap yönetimi sayfası içermez (bkz. ACCOUNT_ADMIN_PAGES);
// sunucu zaten eler, ama kalıplar da o sınırı öğretici biçimde yansıtmalı.

export type RoleTemplate = {
  /** DB satırının id'si. Koddaki yedek kalıplarda yoktur. */
  id?: string
  key: string
  name: string
  description: string
  /** Görüntüleme izni verilen sayfalar. */
  allowedPaths: string[]
  /** Bunların hangilerinde yazma da var (allowedPaths'in alt kümesi). */
  writablePaths: string[]
  /** Kartların sırası; küçük olan önce. Yedek listede dizi sırası geçerlidir. */
  sortOrder?: number
  /** Pasif kalıp firma ekranında listelenmez (yalnız panelde görünür). */
  isActive?: boolean
}

const TICKET_PAGES = ["/restoran/masalar", "/restoran/masa-listesi", "/restoran/adisyonlar"]

export const DEFAULT_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "kasiyer",
    name: "Kasiyer",
    description: "Tezgâh satışı ve adisyon kapatma. Menü/reçete ve rakamlar kapalı.",
    allowedPaths: ["/restoran/satis", ...TICKET_PAGES],
    writablePaths: ["/restoran/satis", ...TICKET_PAGES],
  },
  {
    key: "garson",
    name: "Garson",
    description: "Masa açma ve sipariş girme. Kahveci satış ekranı ve raporlar kapalı.",
    allowedPaths: TICKET_PAGES,
    writablePaths: TICKET_PAGES,
  },
  {
    key: "kasiyer-sef",
    name: "Vardiya Sorumlusu",
    description: "Kasiyerin tüm yetkileri + kontrol listesi ve gün sonu raporları.",
    allowedPaths: [
      "/restoran/satis",
      ...TICKET_PAGES,
      "/restoran/kontrol-listesi",
      "/restoran/raporlar",
      "/personel/vardiya",
    ],
    writablePaths: [
      "/restoran/satis",
      ...TICKET_PAGES,
      "/restoran/kontrol-listesi",
      "/personel/vardiya",
    ],
  },
  {
    key: "depo",
    name: "Depo Sorumlusu",
    description: "Ürün, depo ve stok transferi. Fiyat/ciro içeren ekranlar kapalı.",
    allowedPaths: [
      "/stok/urunler",
      "/stok/hizmetler",
      "/depolar",
      "/stok/transfer",
      "/stok/etiket",
      "/raporlar/stok",
      "/alis/irsaliye",
      "/satis/irsaliye",
    ],
    writablePaths: ["/stok/urunler", "/stok/hizmetler", "/depolar", "/stok/transfer", "/stok/etiket"],
  },
  {
    key: "satis-temsilcisi",
    name: "Satış Temsilcisi",
    description: "Müşteri, teklif ve sipariş. Alış tarafı ve finans kapalı.",
    allowedPaths: [
      "/cari/musteri",
      "/teklif",
      "/satis/siparis",
      "/satis/fatura",
      "/stok/urunler",
      "/raporlar/satis",
      "/raporlar/cari",
    ],
    writablePaths: ["/cari/musteri", "/teklif", "/satis/siparis"],
  },
  {
    key: "muhasebe-asistani",
    name: "Muhasebe Asistanı",
    description: "Fatura ve cari kayıt girişi. Personel/bordro ve abonelik kapalı.",
    allowedPaths: [
      "/satis/fatura",
      "/alis/fatura",
      "/alis/gelen-e-faturalar",
      "/cari/musteri",
      "/cari/tedarikci",
      "/finans/hareketler",
      "/raporlar/satis",
      "/raporlar/alis",
      "/raporlar/cari",
      "/raporlar/vergi",
    ],
    writablePaths: [
      "/satis/fatura",
      "/alis/fatura",
      "/cari/musteri",
      "/cari/tedarikci",
      "/finans/hareketler",
    ],
  },
  {
    key: "gozlemci",
    name: "Gözlemci",
    description: "Yalnız rapor okuma; hiçbir ekranda değişiklik yapamaz.",
    allowedPaths: [
      "/dashboard",
      "/raporlar/satis",
      "/raporlar/alis",
      "/raporlar/cari",
      "/raporlar/stok",
      "/raporlar/nakit-banka",
    ],
    writablePaths: [],
  },
]

export const DEFAULT_ROLE_TEMPLATE_BY_KEY = new Map(
  DEFAULT_ROLE_TEMPLATES.map((t) => [t.key, t])
)

/**
 * API'den/DB'den gelen satırı kalıp şekline indirger.
 *
 * İstemci tarafı yalnız bu şekli tanır: DB satırı createdAt/updatedAt gibi alanlar da
 * taşır ve `description` null gelebilir — kartlar boş metin bekliyor.
 */
export function toRoleTemplate(row: {
  id?: string
  key: string
  name: string
  description?: string | null
  allowedPaths?: string[] | null
  writablePaths?: string[] | null
  sortOrder?: number | null
  isActive?: boolean | null
}): RoleTemplate {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? "",
    allowedPaths: row.allowedPaths ?? [],
    writablePaths: row.writablePaths ?? [],
    sortOrder: row.sortOrder ?? 0,
    isActive: row.isActive ?? true,
  }
}
