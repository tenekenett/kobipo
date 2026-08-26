// "Aboneliğim" ekranının SÖZE dökülen kararları — saf, DB'siz, test edilebilir.
//
// Neden ayrı dosya (aynı gerekçe [[lib/billing/notice.ts]] için de geçerli): bu iki
// cümlenin ikisi de yanlış kurulduğunda müşteri YANLIŞ BİLGİYLE karar veriyor —
// biri "aboneliğim aktif" diye ödemeyi erteletiyor, diğeri "şubelerim silinmiş"
// paniği yaratıyor. Bileşenin içinde kalırlarsa test edilemezler.

import type { QuotaStatus } from "@/lib/billing/entitlements"

/** Rozetin `components/ui/badge.tsx` varyantı + üstündeki metin. */
export type SubscriptionBadge = {
  variant: "aktif" | "odendi" | "bekliyor" | "gecikti"
  text: string
}

/** Rozeti belirleyen abonelik görünümü — uçtan gelen JSON'un ilgili alanları. */
export type SubscriptionBadgeView = {
  isInGrace: boolean
  isPaidActive: boolean
  isTrialActive: boolean
  cancelAtPeriodEnd: boolean
}

/**
 * Durum rozeti. **SIRA kararın kendisidir:**
 *
 * `PAST_DUE` + hoşgörü, `isPaidActive` DEĞİLDİR ama "erişim açık" hâlidir; buna karşılık
 * `cancelAtPeriodEnd` işaretli abonelik hâlâ `isPaidActive`tir. Yani "açık mı" sorusuyla
 * "sorun var mı" sorusu farklı eksenler — önce SORUNLU hâller sorulmazsa ödemesi
 * alınamamış müşteriye yeşil "Aktif" yazar ve kapanmaya gün saydığını göremez.
 */
export function subscriptionBadge(sub: SubscriptionBadgeView): SubscriptionBadge {
  if (sub.isInGrace) return { variant: "gecikti", text: "Ödeme bekleniyor" }
  if (sub.isPaidActive && sub.cancelAtPeriodEnd) {
    return { variant: "bekliyor", text: "Dönem sonunda iptal" }
  }
  if (sub.isPaidActive) return { variant: "odendi", text: "Aktif" }
  if (sub.isTrialActive) return { variant: "aktif", text: "Deneme sürümü" }
  return { variant: "gecikti", text: "Süresi doldu" }
}

/**
 * Kota satırının altındaki açıklama.
 *
 * Aboneliksiz hesapta kota tanım gereği 0'dır (`getAccountQuotas` → fail closed), ama
 * AÇIK şubeler yerinde durur. Eski metin bu hâlde "0 hakkınız var / 3 kullanılmış"
 * diyordu ve müşteri şubelerinin silindiğini sanıyordu — cümle bu yüzden kotayı değil
 * SEBEBİ anlatır. (Faz 6, docs/paket-abonelik/ABONELIK-TAMAMLAMA.md)
 */
export function quotaHint(status: Pick<QuotaStatus, "hasActiveSubscription" | "remaining">): string {
  if (!status.hasActiveSubscription) {
    return "Aboneliğiniz aktif değil — yeni açma hakkı yok, mevcutlar duruyor."
  }
  return status.remaining > 0
    ? `${status.remaining} tane daha açabilirsiniz.`
    : "Hakkınızın tamamı kullanımda."
}
