// TEMEL (ÜCRETSİZ) MODÜLLER — "satın alınmadan herkeste açık gelen" modül kümesi.
//
// Kaynak TEK: `PricingItem.isFree` (sistem-admin → Paket & Fiyat Yönetimi). Kod tarafında
// sabit bir liste YOKTUR; hangi modülün temel olduğu işletme kararıdır ve panelden döner.
//
// Kümenin üç tüketicisi var, üçü de buradan okur:
//   1. `applyEntitlements`  → yetki her yeniden hesaplandığında ücretsizler AÇIK kalır
//                             (abonelik bitmiş/hiç olmamış olsa bile).
//   2. `createCompany`      → yeni firma ücretsiz modüller açık doğar.
//   3. `isAccountLocked`    → "kilitli hesap" ölçüsü yalnız ÜCRETLİ modüllere bakar.
//
// Ücretsizlik `Subscription.purchasedModules`a YAZILMAZ: orası satın alınanın kaydıdır.
// Ücretsiz küme her uygulamada yeniden okunur, böylece admin bir modülü ücretliye
// çevirdiğinde hiçbir hesapta "satın alınmış gibi" iz kalmaz.

import { prisma } from "@/lib/db/prisma"
import { sanitizeFreeModules, withModuleDependencies } from "@/lib/modules"
import { moduleKeyFromPriceKey } from "@/lib/billing/constants"

/**
 * Kısa ömürlü süreç içi önbellek. Küme neredeyse hiç değişmiyor ama çok okunuyor:
 * altı panel sayfasının kilit kontrolü, her `applyEntitlements` (gece reconcile'ı bunu
 * hesap hesap çağırıyor) ve her sipariş fiyatlaması. TTL kısa tutuldu ki sistem
 * yöneticisi bir modülü ücretsiz yaptığında değişiklik hemen görünsün; yazan uç ayrıca
 * `invalidateFreeModuleCache()` ile önbelleği kendi süreçinde düşürür.
 *
 * React'in `cache()`'i kullanılmadı: bu dosya cron ve script bağlamlarında da koşuyor,
 * orada istek kapsamı yok.
 */
const CACHE_TTL_MS = 10_000
let cached: { at: number; keys: string[] } | null = null

/** Ücretsiz modül önbelleğini düşürür (yazma sonrası). */
export function invalidateFreeModuleCache(): void {
  cached = null
}

/** Sistem yöneticisinin TEMEL (ücretsiz) işaretlediği modül anahtarları. */
export async function getFreeModuleKeys(): Promise<string[]> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.keys
  const rows = await prisma.pricingItem.findMany({
    where: { isFree: true },
    select: { key: true },
  })
  const keys = sanitizeFreeModules(rows.map((r) => moduleKeyFromPriceKey(r.key)).filter(Boolean))
  cached = { at: Date.now(), keys }
  return keys
}

/** `PricingItem` satırlarından ücretsiz kümeyi çözer (sorgu zaten elde olduğunda). */
export function freeModulesFromPricingItems(
  items: Array<{ key: string; isFree?: boolean | null }>,
): string[] {
  return sanitizeFreeModules(
    items.filter((i) => i.isFree).map((i) => moduleKeyFromPriceKey(i.key)).filter(Boolean),
  )
}

/**
 * Bir modülün ücretsiz yapılmasına engel olan bağımlılıklar: ücretli kalan gereksinimler.
 * Boş dizi = engel yok. Uç bunu kullanıcıya okunur bir hata mesajına çevirir.
 */
export function paidDependenciesOf(moduleKey: string, freeSet: string[]): string[] {
  const free = new Set(freeSet)
  return withModuleDependencies([moduleKey]).filter((k) => k !== moduleKey && !free.has(k))
}
