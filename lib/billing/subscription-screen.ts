/**
 * ABONELİK EKRANININ KARARLARI — saf, sunucuyla aynı ölçüler.
 *
 * Ekranın kendisi (app/(dashboard)/ayarlar/abonelik/page.tsx) büyük bir istemci
 * bileşeni; içine gömülü koşullar test edilemiyordu ve tam da bu yüzden sunucu
 * değiştiğinde geride kalıyorlardı:
 *
 *   - 2026-09-04: sipariş ucu faturayı SATIN ALAN firmaya kesmeye başladı, ekran hâlâ
 *     hesap kökünün fatura bilgisini yüklüyordu (ek firmanın ekranında ana firmanın
 *     VKN'si görünüyor, ödemede o firmanın alanlarına yazılıyordu).
 *   - Aynı gün: `catalog` ucu "firmada ADMIN olma" şartını hiç uygulamıyordu, `orders`
 *     uyguluyordu — ekran "satın alabilirsin" derken uç 403 döndürebiliyordu.
 *
 * Bu yüzden ekranın kararları buraya taşındı: kural bir kez yazılır, testle kilitlenir
 * ve bileşen yalnızca sonucu çizer. Aynı fikir kotada `getAccountQuotas`, yetkide
 * `resolvePurchaseAuthority` ile kurulmuştu (bkz. CLAUDE.md).
 */

import type { PurchaseBlockedReason } from "@/lib/billing/purchase-authority"

/**
 * Sunucuya GÖNDERİLECEK kota adedi.
 *
 * Şube ve ek firma kota SATIN ALAMAZ (uç 400 döner): hesap ağacı sonsuza dallanmasın
 * diye açma hakkı yalnız kökten alınır. Kartı gizlemek yetmez — paket kotayla gelse
 * bile tutara girmemeli, yoksa ekranda görünen tutar ile tahsilat ayrışır.
 */
export function resolveQuotaSelection(input: {
  isAccountRoot: boolean
  branchQuota: number
  companyQuota: number
}): { branchQuota: number; companyQuota: number } {
  if (!input.isAccountRoot) return { branchQuota: 0, companyQuota: 0 }
  return {
    branchQuota: Math.max(0, input.branchQuota),
    companyQuota: Math.max(0, input.companyQuota),
  }
}

/** Kota kartları yalnız hesap kökünde çizilir; üyede yerini açıklayıcı not alır. */
export function showsQuotaCards(isAccountRoot: boolean): boolean {
  return isAccountRoot
}

export type PayBlockedBy =
  /** Yalnız-kota siparişi sunucudaki kapıya takılıyor (pasif abonelik / kota artmıyor). */
  | "quota-top-up"
  /** Sanal POS yapılandırılmamış. */
  | "paytr"
  /** Kullanıcının bu firmada satın alma yetkisi yok. */
  | "authority"
  /** Seçim boş ya da tutar sıfır — ödenecek bir şey yok. */
  | "empty-selection"

/**
 * "Öde" düğmesi açık mı, değilse NEDEN?
 *
 * Sebebi döndürmek zorunlu: düğmeyi sessizce kapatmak, kullanıcının neyi düzelteceğini
 * bilmediği bir ekran demekti. Sıra da önemli — önce sunucunun reddedeceği durumlar,
 * en sonda "hiçbir şey seçilmemiş".
 */
export function resolvePayButton(input: {
  quotaTopUpBlocked?: boolean
  paytrEnabled: boolean
  canPurchase: boolean
  amount: number
  resolvedModules: readonly string[]
  branchQuota: number
  companyQuota: number
}): { enabled: boolean; blockedBy: PayBlockedBy | null } {
  if (input.quotaTopUpBlocked) return { enabled: false, blockedBy: "quota-top-up" }
  if (!input.paytrEnabled) return { enabled: false, blockedBy: "paytr" }
  if (!input.canPurchase) return { enabled: false, blockedBy: "authority" }
  const selectedSomething =
    input.resolvedModules.length > 0 || input.branchQuota > 0 || input.companyQuota > 0
  if (!(input.amount > 0) || !selectedSomething) {
    return { enabled: false, blockedBy: "empty-selection" }
  }
  return { enabled: true, blockedBy: null }
}

/**
 * Satın alma kapalıyken gösterilecek cümle.
 *
 * İki sebep iki farklı çözüm gerektiriyor: biri "yetkili biri ödesin", diğeri "ana
 * firmadan ödeyin". Tek cümleyle geçmek, şube sorumlusunu ana firmayı aramaya
 * yönlendirmezdi.
 */
export function purchaseNoticeFor(
  reason: PurchaseBlockedReason | null,
  accountName?: string | null,
): string | null {
  if (reason === "not-admin") return "Abonelik satın alma yalnızca firma yöneticisine açıktır."
  if (reason === "not-account-admin") {
    return (
      "Bu firmanın aboneliğini yalnızca hesap yöneticisi" +
      (accountName ? ` (${accountName} yöneticisi)` : "") +
      " satın alabilir."
    )
  }
  return null
}
