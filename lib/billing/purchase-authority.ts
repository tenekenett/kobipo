/**
 * ABONELİK SATIN ALMA YETKİSİ — ekranın ve ucun TEK kaynağı.
 *
 * Kural iki katmanlıdır ve ikisi de gerekir:
 *   1. Satın alınan firmada ADMIN olacaksın. Abonelik ekranı özel rollere de açılabilir
 *      (bkz. `lib/page-access.ts`), ama görmek ödemek değildir.
 *   2. Firma hesap kökü DEĞİLSE, ayrıca hesabın (kök firmanın) ADMIN'i olacaksın.
 *      Şubeye atanmış bir ADMIN şubenin ekranını görür ama ödemeyi hesabın sahibi yapar:
 *      fatura ve tahsilat sorumluluğu oradadır. Süper-admin bu ikinci katmanı atlar.
 *
 * Neden ortak modül: kural 2026-09-04'e kadar iki yere ayrı ayrı yazılmıştı ve
 * `catalog/route.ts` 1. katmanı hiç uygulamıyordu — abonelik sayfası açık olan ADMIN
 * OLMAYAN kullanıcıda "Öde" düğmesi AÇIK geliyor, form doldurulup basılınca uç 403
 * döndürüyordu. Kotada aynı hatadan kaçınmak için `getAccountQuotas` nasıl tek kaynaksa
 * (bkz. CLAUDE.md), yetki de öyle: ikisi ayrışırsa kullanıcı duvara çarpar.
 */

export type PurchaseBlockedReason =
  /** Bu firmada ADMIN değil (ekranı özel rolüyle görüyor olabilir). */
  | "not-admin"
  /** Firma bir şube/ek firma ve kullanıcı hesap kökünün ADMIN'i değil. */
  | "not-account-admin"

export type PurchaseAuthority =
  | { ok: true; reason: null }
  | { ok: false; reason: PurchaseBlockedReason; error: string }

export const PURCHASE_DENIED_MESSAGE: Record<PurchaseBlockedReason, string> = {
  "not-admin": "Abonelik yönetimi yalnızca firma yöneticisine açıktır",
  "not-account-admin":
    "Bu firmanın aboneliğini yalnızca hesap yöneticisi (ana firmanın yöneticisi) satın alabilir",
}

export type PurchaseAuthorityFacts = {
  /** Satın alınan firmadaki ÜYELİK rolü (`ensureCompanyAccess` → `role`). */
  companyRole: string | null | undefined
  /** Satın alınan firma hesap kökü mü (`resolveAccountRootId(companyId) === companyId`)? */
  isAccountRoot: boolean
  isSuperAdmin: boolean
  /** Hesap kökünde ADMIN üyeliği var mı? Kök firmada okunmaz. */
  isAccountRootAdmin: boolean
}

export function resolvePurchaseAuthority(facts: PurchaseAuthorityFacts): PurchaseAuthority {
  if (facts.companyRole !== "ADMIN") {
    return { ok: false, reason: "not-admin", error: PURCHASE_DENIED_MESSAGE["not-admin"] }
  }
  if (!facts.isAccountRoot && !facts.isSuperAdmin && !facts.isAccountRootAdmin) {
    return {
      ok: false,
      reason: "not-account-admin",
      error: PURCHASE_DENIED_MESSAGE["not-account-admin"],
    }
  }
  return { ok: true, reason: null }
}
