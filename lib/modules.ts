// Firma bazında açılıp kapatılabilen modüller. Her modül, dashboard sidebar'ındaki
// bir nav grubunu (navGroups title) kontrol eder. Kapalı modüller menüde gizlenir.
//
// Saklama: company.disabledModules (String[]) — kapalı modül anahtarlarını tutar.
// Boş dizi = tüm modüller açık (varsayılan, mevcut firmalar etkilenmez).

export interface ModuleDef {
  /** DB'de saklanan kararlı anahtar */
  key: string
  /** Kontrol ettiği navGroups başlığı */
  group: string
  label: string
  description: string
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
]

export const MODULE_KEYS = MANAGEABLE_MODULES.map((m) => m.key)

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
