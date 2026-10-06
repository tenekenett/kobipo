// TEMEL (ÜCRETSİZ) MODÜLLER — "satın alınmadan herkeste açık gelen" modül kümesi.
//
// Kaynak TEK: `PricingItem.isFree` (sistem-admin → Paket & Fiyat Yönetimi). Kod tarafında
// sabit bir liste YOKTUR; hangi modülün temel olduğu işletme kararıdır ve panelden döner.
//
// Kümenin üç tüketicisi var, üçü de buradan okur:
//   1. `applyEntitlements`  → yetki her yeniden hesaplandığında ücretsizler AÇIK kalır
//                             (abonelik bitmiş/hiç olmamış olsa bile).
//   2. `createCompany`      → yeni firma ücretsiz modüller açık doğar.
//   3. `ModuleUpsellBanner` → panodaki tanıtım şeridi yalnız kapalı ve SATIŞTAKİ ücretli
//                             modülleri sayar (`getSellableModuleKeys`; ücretsiz olan ve
//                             sistem yönetiminde "Aktif" olmayan duyurulmaz).
//
// `isAccountLocked` bu kümeyi ARTIK OKUMUYOR (2026-09-05). Okuduğu sürece kilit ölçüsü
// ücretsiz kümenin büyüklüğüne bağlıydı: altı modül temel yapılınca "hiç modülü yok"
// sorusu "Restoran almamış"a dönüştü ve çalışan firmalar satın alma duvarına düştü.
//
// Ücretsizlik `Subscription.purchasedModules`a YAZILMAZ: orası satın alınanın kaydıdır.
// Ücretsiz küme her uygulamada yeniden okunur, böylece admin bir modülü ücretliye
// çevirdiğinde hiçbir hesapta "satın alınmış gibi" iz kalmaz.

import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS, sanitizeFreeModules, withModuleDependencies } from "@/lib/modules"
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
let cached: { at: number; keys: string[]; sellable: string[] } | null = null

/** Ücretsiz modül önbelleğini düşürür (yazma sonrası). */
export function invalidateFreeModuleCache(): void {
  cached = null
}

async function modulePricing(): Promise<{ keys: string[]; sellable: string[] }> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached
  const rows = await prisma.pricingItem.findMany({
    where: { key: { startsWith: "module:" } },
    select: { key: true, isFree: true, isActive: true },
  })
  cached = { at: Date.now(), keys: freeModulesFromPricingItems(rows), sellable: sellableModulesFromPricingItems(rows) }
  return cached
}

/** Sistem yöneticisinin TEMEL (ücretsiz) işaretlediği modül anahtarları. */
export async function getFreeModuleKeys(): Promise<string[]> {
  return (await modulePricing()).keys
}

/**
 * SATIŞTAKİ ücretli modüller: sistem yönetiminde (Paket & Fiyat) "Aktif" ve ücretsiz değil.
 * Panodaki tanıtım şeridi YALNIZ bunları duyurur. 2026-10-06'ya kadar şerit "ücretsiz
 * değilse satılıktır" diye kendisi karar veriyordu: fiyat kalemi pasif doğan Muhasebe
 * (pilot öncesi, kimseye açık değil) tüm firmaların yöneticilerine "satın aldığınızda
 * menüler açılır" diye duyuruldu; "İncele"nin açtığı abonelik ekranı ise onu (doğru
 * biçimde) listelemiyordu.
 */
export async function getSellableModuleKeys(): Promise<string[]> {
  return (await modulePricing()).sellable
}

export function sellableModulesFromPricingItems(
  items: Array<{ key: string; isFree?: boolean | null; isActive?: boolean | null }>,
): string[] {
  return items
    .filter((i) => i.isActive && !i.isFree)
    .map((i) => moduleKeyFromPriceKey(i.key))
    .filter((k): k is string => Boolean(k) && MODULE_KEYS.includes(k as string))
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
