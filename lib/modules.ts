// Firma bazında açılıp kapatılabilen modüller. Her modül, dashboard sidebar'ındaki
// bir nav grubunu (navGroups title) kontrol eder. Kapalı modüller menüde gizlenir.
//
// Saklama: company.disabledModules (String[]) — kapalı modül anahtarlarını tutar.
// Boş dizi = tüm modüller açık.
//
// DİKKAT — bu bir RED listesidir: burada olmayan her anahtar AÇIK sayılır. Bu yüzden
// yeni firma `disabledModules = MODULE_KEYS` ile (kilitli) yaratılır ve listeye YENİ bir
// modül eklendiğinde mevcut kayıtlarda o anahtar bulunmadığı için herkese açık düşer.
// Yeni modül eklerken mevcut satırları da kapatan bir migration yazın.

export interface ModuleDef {
  /** DB'de saklanan kararlı anahtar */
  key: string
  /** Kontrol ettiği navGroups başlığı */
  group: string
  label: string
  description: string
  /**
   * Bu modül açıkken zorunlu olarak açık olması gereken modüller.
   * Örn. Restoran & Kafe → Stok: reçetenin tek işi stok düşürmek, Stok kapalıyken
   * anlamsız; ayrıca reçete sayfası "Stok" nav grubunda yaşıyor.
   */
  requires?: string[]
}

export const MANAGEABLE_MODULES: ModuleDef[] = [
  {
    key: "sales",
    group: "Satış",
    label: "Satış",
    description: "Satış faturası, müşteri, teklif, irsaliye, sipariş",
  },
  {
    key: "purchase",
    group: "Alış",
    label: "Alış",
    description: "Alış faturası, tedarikçi, gelen e-faturalar, sipariş",
  },
  {
    key: "stock",
    group: "Stok",
    label: "Stok",
    description: "Ürün, hizmet, depo, stok transfer",
  },
  {
    key: "finance",
    group: "Finans",
    label: "Finans",
    description: "Finans kanalları, hareketler, çek-senet, mutabakat",
  },
  {
    key: "reports",
    group: "Raporlar",
    label: "Raporlar",
    description: "Satış, alış, cari, vergi, stok ve personel raporları",
  },
  {
    key: "hr",
    group: "Personel",
    label: "Personel",
    description: "Personel, maaş, izin, zimmet, İK",
  },
  {
    key: "restaurant",
    group: "Restoran & Kafe",
    label: "Restoran & Kafe",
    description: "Menü, reçeteli stok düşümü, kahveci satış ekranı, günlük karlılık",
    requires: ["stock"],
  },
]

export const MODULE_KEYS = MANAGEABLE_MODULES.map((m) => m.key)

const MODULE_BY_KEY = new Map(MANAGEABLE_MODULES.map((m) => [m.key, m]))

/**
 * Seçilen modül kümesini bağımlılıklarıyla birlikte tamamlar (ör. "restaurant"
 * seçiliyse "stock" da eklenir). Hem satın alma arayüzünde hem de hak uygulanırken
 * çağrılır; böylece arayüz atlansa bile DB'ye tutarlı bir küme yazılır.
 */
export function withModuleDependencies(keys: string[]): string[] {
  const result = new Set<string>()
  const visit = (key: string) => {
    if (result.has(key)) return
    const def = MODULE_BY_KEY.get(key)
    if (!def) return
    result.add(key)
    for (const dep of def.requires ?? []) visit(dep)
  }
  for (const key of keys) visit(key)
  return Array.from(result)
}

/** Bir modülün kaldırılmasını engelleyen modüller (ör. "stock" ← "restaurant"). */
export function modulesRequiring(key: string, selected: string[]): string[] {
  const selectedSet = new Set(selected)
  return MANAGEABLE_MODULES.filter(
    (m) => selectedSet.has(m.key) && (m.requires ?? []).includes(key)
  ).map((m) => m.key)
}

/** navGroups başlığı -> modül anahtarı (yalnızca yönetilebilir gruplar için) */
export const MODULE_GROUP_TO_KEY: Record<string, string> = Object.fromEntries(
  MANAGEABLE_MODULES.map((m) => [m.group, m.key])
)

/** Bilinmeyen anahtarları eler, benzersizleştirir. */
export function sanitizeDisabledModules(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const valid = new Set(MODULE_KEYS)
  return Array.from(new Set(input.filter((k): k is string => typeof k === "string" && valid.has(k))))
}

export function isModuleEnabled(disabledModules: string[] | undefined | null, key: string): boolean {
  return !(disabledModules ?? []).includes(key)
}

/**
 * Hesabın hiçbir modülü açık değil mi? Yeni firma bu hâlde doğar (modül = satın alınan
 * şey) ve abonelik süresi dolunca buraya geri döner.
 *
 * Rakam basan her panelin ilk kontrolü budur: kilitli hesapta widget yerine
 * `LockedAccount` gösterilir. Giriş sonrası kullanıcı rolüne göre `/dashboard/admin`,
 * `/dashboard/sales`... sayfalarından BİRİNE düşüyor — kontrol yalnız `/dashboard`'da
 * olursa satın alma ekranını hiç kimse görmez.
 */
export function isAccountLocked(disabledModules: string[] | undefined | null): boolean {
  const disabled = new Set(disabledModules ?? [])
  return MODULE_KEYS.every((key) => disabled.has(key))
}

/**
 * Kapalı modül listesini bağımlılıklarla tutarlı hale getirir: açık bir modülün
 * gerektirdiği modül kapalı bırakılamaz (ör. Restoran & Kafe açıkken Stok).
 * Elle modül yönetimi yapan uçlarda (sistem-admin) sanitize'ın hemen ardından
 * çağrılır.
 */
export function reconcileDisabledModules(disabled: string[]): string[] {
  const disabledSet = new Set(sanitizeDisabledModules(disabled))
  const enabled = withModuleDependencies(MODULE_KEYS.filter((k) => !disabledSet.has(k)))
  const enabledSet = new Set(enabled)
  return MODULE_KEYS.filter((k) => !enabledSet.has(k))
}
