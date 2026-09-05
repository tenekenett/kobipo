// Firma bazında açılıp kapatılabilen modüller. Her modül, dashboard sidebar'ındaki
// bir nav grubunu (navGroups title) kontrol eder. Kapalı modüller menüde gizlenir.
//
// Saklama: company.disabledModules (String[]) — kapalı modül anahtarlarını tutar.
// Boş dizi = tüm modüller açık.
//
// DİKKAT — bu bir RED listesidir: burada olmayan her anahtar AÇIK sayılır. Bu yüzden
// yeni firma `defaultDisabledModules(free)` ile (ücretsizler hariç kilitli) yaratılır ve
// listeye YENİ bir modül eklendiğinde mevcut kayıtlarda o anahtar bulunmadığı için
// herkese açık düşer. Yeni modül eklerken mevcut satırları da kapatan bir migration yazın.
//
// TEMEL (ÜCRETSİZ) MODÜL: hangi modülün ücretsiz olduğu bu dosyada SABİT DEĞİLDİR —
// sistem yöneticisi belirler ve `PricingItem.isFree` alanında durur. Bu dosya yalnızca
// saf kuralları verir (`sanitizeFreeModules`, `defaultDisabledModules`, `isAccountLocked`);
// kümenin kendisini okuyan yer: lib/billing/free-modules.ts → `getFreeModuleKeys()`.

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

/** Modülün insan okunur adı. Bilinmeyen anahtar kendisi olarak döner. */
export function moduleLabel(key: string): string {
  return MODULE_BY_KEY.get(key)?.label ?? key
}

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
 * TEMEL (ücretsiz) modül kümesini temizler: bilinmeyen anahtarları eler ve
 * BAĞIMLILIĞI ÜCRETLİ OLAN modülü kümeden düşürür.
 *
 * Bağımlılık kuralı burada olmazsa ücretsizlik sızar: "Restoran & Kafe" ücretsiz
 * işaretlenirse `withModuleDependencies` onunla birlikte "Stok"u da açar — yani parası
 * alınan bir modül bedavaya verilmiş olur. Kural fixpoint'e kadar uygulanır (a → b → c).
 *
 * Sistem-admin ucu aynı ihlali daha erken, açık bir hata mesajıyla reddeder
 * (app/api/billing/pricing/route.ts); burası ikinci savunmadır.
 */
export function sanitizeFreeModules(input: unknown): string[] {
  const set = new Set(sanitizeDisabledModules(input))
  let changed = true
  while (changed) {
    changed = false
    for (const key of Array.from(set)) {
      const requires = MODULE_BY_KEY.get(key)?.requires ?? []
      if (requires.some((dep) => !set.has(dep))) {
        set.delete(key)
        changed = true
      }
    }
  }
  return MODULE_KEYS.filter((k) => set.has(k))
}

/**
 * Yeni bir hesabın/firmanın doğacağı `disabledModules` listesi: ücretsiz modüller AÇIK,
 * kalan her şey KAPALI. Ücretsiz küme boşsa sonuç eski davranışın aynısıdır (tam kilit).
 */
export function defaultDisabledModules(freeModuleKeys: string[] = []): string[] {
  const free = new Set(sanitizeFreeModules(freeModuleKeys))
  return MODULE_KEYS.filter((k) => !free.has(k))
}

/**
 * Firmanın HİÇBİR modülü açık değil mi? Rakam basan panel sayfalarının ilk kontrolü
 * budur: kilitli firmada widget yerine `LockedAccount` gösterilir.
 *
 * ÖLÇÜ 2026-09-05'te DEĞİŞTİ — önceden "ücretli modüllerin hepsi kapalı mı?" diye
 * soruyordu ve ücretsizler ölçüye girmiyordu. O soru, her modülün ücretli olduğu düzende
 * doğruydu; ücretsiz küme büyüyünce sessizce başka bir şeye dönüştü:
 *
 *   2026-08-31'de yedi modülün altısı TEMEL yapıldı → geriye tek ücretli modül
 *   (Restoran & Kafe) kaldı → "hiçbir şey satın almamış" ile "Restoran almamış" AYNI
 *   soru oldu. Restoran kullanmayan 33 firmanın 15'i, altı modülü açık ÇALIŞIRKEN
 *   "hesabınız hazır, şimdi modüllerinizi seçin" satın alma ekranına düştü; sistem-admin
 *   kartı ise (doğru biçimde) 6/7 açık gösteriyordu. Çelişkinin kaynağı buydu.
 *
 * Bugünkü ölçü ücretli/ücretsiz ayrımı YAPMAZ, "açık modül var mı" diye sorar. Yeni
 * firmanın modül seçim ekranına düşmesi artık bu ölçüye değil, onboarding'in son adımına
 * bağlıdır (app/(dashboard)/companies/onboarding/complete/page.tsx); firma zaten temel
 * modülleri açık doğduğu için "boş panel" sorunu da yok.
 *
 * Kontrol altı panel sayfasının HEPSİNDE durmalı — giriş sonrası kullanıcı rolüne göre
 * `/dashboard/admin`, `/dashboard/sales`... sayfalarından birine düşüyor. Tekrarı
 * önlemek için tek yerden çözülür: lib/dashboard/locked.ts → `lockedScreenFor`.
 */
export function isAccountLocked(disabledModules: string[] | undefined | null): boolean {
  const disabled = new Set(disabledModules ?? [])
  return MODULE_KEYS.every((key) => disabled.has(key))
}

/**
 * ELLE KAPATMA (suppression) uygulanmış açık modül kümesi.
 *
 * `withModuleDependencies` ile YÖNÜ TERSTİR: orada "açık modülün gereksinimi de açılır"
 * (Restoran seçilirse Stok eklenir), burada "kapatılan modülün BAĞIMLISI da kapanır"
 * (Stok kapatılırsa Restoran da kapanır). Elle kapatmada ikinci yön doğrudur — aksi
 * halde sistem yöneticisinin "Stok'u kapat" tıklaması, Restoran açık olduğu için
 * bağımlılık tamamlanırken sessizce geri alınırdı. Sistem-admin ucu ikisini sırayla
 * kullanır: önce seçim bağımlılıklarıyla tamamlanır, sonra kapatılanlar düşülür.
 *
 * Fixpoint'e kadar yürür (a → b → c zinciri).
 */
export function applySuppression(open: string[], suppressed: string[]): string[] {
  const suppressedSet = new Set(sanitizeDisabledModules(suppressed))
  const result = new Set(sanitizeDisabledModules(open).filter((k) => !suppressedSet.has(k)))
  let changed = true
  while (changed) {
    changed = false
    for (const key of Array.from(result)) {
      const requires = MODULE_BY_KEY.get(key)?.requires ?? []
      if (requires.some((dep) => !result.has(dep))) {
        result.delete(key)
        changed = true
      }
    }
  }
  return MODULE_KEYS.filter((k) => result.has(k))
}

/**
 * Elle kapatılabilecek modül kümesini temizler: yalnız ÜCRETSİZ modüller kalır.
 *
 * Ücretli modülü kapatmanın doğru yolu satın alma yetkisini (`purchasedModules`)
 * kaldırmaktır; buraya yazılsaydı abonelik kullanılmayan modülü faturalamaya devam
 * eder, üstelik iki ayrı kapatma kanalı doğardı. Ücretsiz kümenin kendisi
 * `PricingItem.isFree`ten gelir (bkz. lib/billing/free-modules.ts).
 */
export function sanitizeSuppressedModules(input: unknown, freeModuleKeys: string[]): string[] {
  const free = new Set(sanitizeFreeModules(freeModuleKeys))
  return sanitizeDisabledModules(input).filter((k) => free.has(k))
}

/**
 * Sistem-admin modül kartının kaydı → iki kanala ayrılmış karar.
 *
 * Kart "bu firmada kapalı olsun" listesini gönderir; kapatmanın iki farklı sonucu var ve
 * karıştırılırsa para yönünde hata olur:
 *
 *   ÜCRETLİ modül  → satın alma yetkisi kalkar (`granted`ten düşer). Kapsam HESAPTIR;
 *                    aksi halde abonelik, kimsenin kullanmadığı modülü faturalamaya
 *                    devam ederdi.
 *   ÜCRETSİZ modül → firmaya kalıcı kapatma (`suppressed`) yazılır. Yetki listesinden
 *                    düşürmek işe yaramaz: `applyEntitlements` ücretsizleri her
 *                    uygulamada geri açar.
 *
 * `granted` YALNIZ ücretli kapatmalara göre hesaplanır. Ücretsiz bir modülün kapatılması
 * bağımlısını da kapatır (Stok → Restoran) ama bu FİRMA düzeyinde olur; hesabın satın
 * aldığı modülü iptal etmez — o iş `applyEntitlements`in üye üye uyguladığı
 * `applySuppression` adımında yapılır.
 */
export function planCompanyModuleUpdate(
  desiredOff: string[],
  freeModuleKeys: string[],
): { suppressed: string[]; granted: string[] } {
  const off = sanitizeDisabledModules(desiredOff)
  const suppressed = sanitizeSuppressedModules(off, freeModuleKeys)
  const suppressedSet = new Set(suppressed)
  const offPaid = off.filter((k) => !suppressedSet.has(k))
  const granted = applySuppression(
    withModuleDependencies(MODULE_KEYS.filter((k) => !offPaid.includes(k))),
    offPaid,
  )
  return { suppressed, granted }
}
