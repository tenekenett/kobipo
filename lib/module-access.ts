// API uçlarının modül karşılıkları — sunucu tarafı modül kapısının haritası.
//
// Menü gizleme (nav.tsx) ve ModuleGuard yalnızca EKRANI kapatır; bu dosya UCU kapatır.
// `ensureCompanyAccess` her istekte buraya bakar (bkz. lib/middleware/company.ts), yani
// satın alınmamış bir modülün API'si elle çağrıldığında da 403 döner.
//
// Sayfa yolları için karşılığı: components/dashboard/nav-config.tsx → moduleKeyForPath.
// Orası nav gruplarından türer; API yolları nav'a benzemediği için harita burada AÇIK yazılır.

/**
 * Root middleware.ts bu header'lara isteğin yolunu/metodunu yazar; route handler'lar
 * çalıştıkları yolu başka türlü göremiyor. Adlar burada durur ki hem middleware (edge)
 * hem sunucu kapısı (node) aynı kaynaktan okusun.
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
