// API uçlarının modül karşılıkları — sunucu tarafı modül kapısının haritası.
//
// Menü gizleme (nav.tsx) ve ModuleGuard yalnızca EKRANI kapatır; bu dosya UCU kapatır.
// `ensureCompanyAccess` her istekte buraya bakar (bkz. lib/middleware/company.ts), yani
// satın alınmamış bir modülün API'si elle çağrıldığında da 403 döner.
//
// Sayfa yolları için karşılığı: components/dashboard/nav-config.tsx → moduleKeyForPath.
// Orası nav gruplarından türer; API yolları nav'a benzemediği için harita burada AÇIK yazılır.

/**
 * Kökteki proxy.ts (eski adıyla middleware) bu header'lara isteğin yolunu/metodunu yazar;
 * route handler'lar çalıştıkları yolu başka türlü göremiyor. Adlar burada durur ki hem
 * proxy hem sunucu kapısı aynı kaynaktan okusun.
 */
export const MODULE_GATE_PATH_HEADER = "x-kobipo-path"
export const MODULE_GATE_METHOD_HEADER = "x-kobipo-method"

export type ApiModuleRule = {
  /** `/api/...` ön eki. En UZUN eşleşen kural kazanır. */
  prefix: string
  /**
   * Okuma (GET/HEAD) için yeterli modüller — herhangi biri açıksa geçer.
   * Bir uç birden çok modüle hizmet edebilir: ürün listesi hem stok ekranının
   * hem satış faturası kalem seçicisinin ihtiyacıdır, o yüzden okuması geniştir.
   */
  read: string[]
  /** Yazma (POST/PUT/PATCH/DELETE) için yeterli modüller. Verilmezse `read` geçerlidir. */
  write?: string[]
}

const SALES_PURCHASE = ["sales", "purchase"]

/**
 * Kural YOKSA uç modül kapısına tabi değildir (auth, billing, e-Dönüşüm, kontör,
 * ayarlar, sistem-admin, sağlık kontrolü...). Modül sistemi yalnızca satılabilir
 * yedi modülü kapsar; hesabın kendisini yönetmek her zaman açıktır — aksi halde
 * kilitli bir hesap paket satın alamazdı.
 */
export const API_MODULE_RULES: ApiModuleRule[] = [
  // ---- Satış & Alış -------------------------------------------------------
  // Fatura/irsaliye/sipariş/teklif uçları yönü YOLDA taşımaz (`?type=SALES` gibi
  // query ile ayrışır), bu yüzden ikisinden biri açıksa geçer. Yön bazında ayrım
  // istenirse kural query'ye değil, ayrı route'lara bağlanmalı.
  { prefix: "/api/faturalar/odemeler", read: [...SALES_PURCHASE, "finance"] },
  { prefix: "/api/faturalar", read: SALES_PURCHASE },
  { prefix: "/api/irsaliye", read: SALES_PURCHASE },
  { prefix: "/api/e-irsaliye", read: SALES_PURCHASE },
  { prefix: "/api/siparis", read: SALES_PURCHASE },
  { prefix: "/api/teklif", read: SALES_PURCHASE },
  { prefix: "/api/fisler", read: SALES_PURCHASE },

  // Cari: müşteri satışın, tedarikçi alışın kaydıdır — yazma o modüle bağlıdır.
  // Okuma geniştir: çek/senet portföyü ve cari ekstre de aynı listeyi okur.
  { prefix: "/api/cari/customers", read: ["sales", "purchase", "finance", "reports", "restaurant"], write: ["sales"] },
  { prefix: "/api/cari/suppliers", read: ["purchase", "sales", "finance", "reports"], write: ["purchase"] },
  { prefix: "/api/cari", read: ["sales", "purchase", "finance", "reports"] },

  // ---- Stok ---------------------------------------------------------------
  // Ürün/depo okuması satış ve alış ekranlarının da ihtiyacı; YAZMA yalnızca stok.
  { prefix: "/api/stok", read: ["stock", "sales", "purchase", "restaurant"], write: ["stock"] },
  { prefix: "/api/depolar", read: ["stock", "sales", "purchase", "restaurant"], write: ["stock"] },

  // ---- Finans -------------------------------------------------------------
  { prefix: "/api/finans", read: ["finance"] },
  { prefix: "/api/kasa", read: ["finance"] },
  { prefix: "/api/banka", read: ["finance"] },
  { prefix: "/api/cek-senet", read: ["finance"] },

  // ---- Raporlar -----------------------------------------------------------
  { prefix: "/api/raporlar/personel", read: ["reports", "hr"] },
  { prefix: "/api/raporlar", read: ["reports"] },

  // ---- Personel -----------------------------------------------------------
  { prefix: "/api/personel", read: ["hr"] },

  // ---- Restoran & Kafe ----------------------------------------------------
  { prefix: "/api/restoran", read: ["restaurant"] },

  // ---- Dışa/İçe aktarma ---------------------------------------------------
  // Dataset adı yolun bir parçası (`/api/export/rapor-satis`), o yüzden ön ek
  // eşleşmesi burada da çalışır. Kapalı modülün verisi export'tan sızmasın.
  { prefix: "/api/export/rapor-personel", read: ["reports", "hr"] },
  { prefix: "/api/export/rapor-", read: ["reports"] },
  { prefix: "/api/export/personel-", read: ["hr"] },
  { prefix: "/api/export/accountant", read: ["reports"] },
  { prefix: "/api/export/products", read: ["stock", "sales", "purchase"] },
  { prefix: "/api/export/invoices", read: SALES_PURCHASE },
  // Gelen e-faturalar alış tarafının gelen kutusu; listeleme ucu
  // (/api/e-donusum/inbox) da aynı kapıdan geçiyor.
  { prefix: "/api/export/gelen-e-faturalar", read: SALES_PURCHASE },
  { prefix: "/api/export/cari", read: ["sales", "purchase", "finance", "reports"] },
  { prefix: "/api/export/ekstre", read: ["sales", "purchase", "finance", "reports"] },
  { prefix: "/api/import", read: ["stock", "sales", "purchase"] },
]

// En uzun ön ek kazansın: "/api/cari/customers" kuralı "/api/cari"den önce denenmeli.
const RULES_BY_SPECIFICITY = [...API_MODULE_RULES].sort((a, b) => b.prefix.length - a.prefix.length)

/** Yol bir modül kuralına giriyorsa onu döndürür, yoksa null (kapıya tabi değil). */
export function moduleRuleForApiPath(pathname: string): ApiModuleRule | null {
  for (const rule of RULES_BY_SPECIFICITY) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix + "/")) return rule
    // "/api/export/rapor-" gibi segment ortasında biten ön ekler için düz startsWith.
    if (rule.prefix.endsWith("-") && pathname.startsWith(rule.prefix)) return rule
  }
  return null
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/** İstek yazma mı? (bilinmeyen metot yazma sayılır — fail closed) */
export function isWriteMethod(method: string): boolean {
  return !READ_METHODS.has(method.toUpperCase())
}

/**
 * İstek, firmanın açık modülleriyle bu ucu kullanabiliyor mu?
 * Kuralı olmayan yol her zaman geçer; kuralı olan yol için gereken modüllerden
 * EN AZ BİRİ açık olmalıdır.
 */
export function isApiPathAllowed(
  pathname: string,
  method: string,
  disabledModules: string[] | undefined | null
): boolean {
  const rule = moduleRuleForApiPath(pathname)
  if (!rule) return true
  const required = isWriteMethod(method) ? rule.write ?? rule.read : rule.read
  const disabled = new Set(disabledModules ?? [])
  return required.some((key) => !disabled.has(key))
}

/** 403 gövdesinde ve logda kullanılacak modül adı (ilk gereken modül). */
export function requiredModulesForApiPath(pathname: string, method: string): string[] {
  const rule = moduleRuleForApiPath(pathname)
  if (!rule) return []
  return isWriteMethod(method) ? rule.write ?? rule.read : rule.read
}

/**
 * ARŞİV İSTİSNASI — salt-okunur arşivdeki hesabın verisini indirebildiği dar kapı.
 *
 * Arşiv kademesinin ([[lib/billing/archive.ts]]) tüm vaadi "verileriniz duruyor ve
 * indirilebilir"dir. Ama arşive giden hesap `EXPIRED` olduğu için ücretli modülleri
 * kapalıdır ve dışa aktarma uçları modül kapısına tabidir — yani vaat, kapının kendisi
 * tarafından çürütülüyordu: müşteriye "verilerinizi indirin" düğmesi gösterip 403
 * döndürmek olurdu.
 *
 * İstisna bilinçli olarak DAR: yalnız `GET`, yalnız `/api/export` altı, yalnız
 * `archivedAt` damgalı hesapta. Yazma, içe aktarma ve diğer uçlar kapalı kalır;
 * salt-okunur rol kapısı (`ensureCompanyExport`) da ayrıca işlemeye devam eder.
 * Genişletilen erişim, müşterinin zaten ödediği ve bizim tuttuğumuz kendi verisidir.
 */
export function isArchiveExportPath(pathname: string, method: string): boolean {
  if (method.toUpperCase() !== "GET") return false
  // Ham `startsWith` yetmez: `/api/exportish` gibi bir uç eklenirse ön ek onu da
  // kapsar ve istisna sessizce genişler. Sınır ya tam yol ya da bir alt yoldur.
  return pathname === "/api/export" || pathname.startsWith("/api/export/")
}

/** 403 gövdesindeki makine-okunur kod; arayüz "satın al" akışını buna göre açar. */
export const MODULE_LOCKED_CODE = "MODULE_LOCKED"

const MODULE_LOCKED_MESSAGE_RE = /Access denied: module locked \(([^)]*)\)/

/**
 * Modül kapısının fırlattığı hata (bkz. lib/middleware/company.ts → assertModuleAccess).
 *
 * Mesaj bilerek `"Access denied"` ile BAŞLAR: route'ların çoğu 403'e maplemeyi bu ifadeye
 * bakarak yapıyor, dolayısıyla helper'a geçmemiş bir uçta da istek reddedilmeye devam eder.
 * `modules` alanı ise `lib/api/errors.ts` üzerinden gövdeye taşınır.
 */
export class ModuleLockedError extends Error {
  readonly code = MODULE_LOCKED_CODE
  readonly modules: string[]

  constructor(modules: string[]) {
    super(`Access denied: module locked (${modules.join("|")})`)
    this.name = "ModuleLockedError"
    this.modules = modules
  }
}

/**
 * Yakalanan hatayı modül kilidi olarak tanır. `instanceof` yetmez: hata bir `cause`
 * zincirinin içinden ya da (Next'in ayrı derlediği katmanlar yüzünden) başka bir sınıf
 * örneği olarak gelebilir; o yüzden mesaj biçimi de ikinci kanal olarak kabul edilir.
 */
export function moduleLockedFrom(error: unknown): ModuleLockedError | null {
  if (error instanceof ModuleLockedError) return error

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const match = MODULE_LOCKED_MESSAGE_RE.exec(message)
  if (!match) return null

  return new ModuleLockedError(match[1] ? match[1].split("|").filter(Boolean) : [])
}
