import { describe, expect, it } from "vitest"
import { quotaHint, subscriptionBadge } from "@/lib/billing/subscription-view"

const view = (over: Partial<Parameters<typeof subscriptionBadge>[0]> = {}) => ({
  isInGrace: false,
  isPaidActive: false,
  isTrialActive: false,
  cancelAtPeriodEnd: false,
  ...over,
})

describe("subscriptionBadge", () => {
  it("ödenmiş ve sorunsuz abonelik → Aktif", () => {
    expect(subscriptionBadge(view({ isPaidActive: true }))).toEqual({
      variant: "odendi",
      text: "Aktif",
    })
  })

  it("iptal işaretli ama dönem sürüyor → yeşil DEĞİL, 'Dönem sonunda iptal'", () => {
    // Erişim açık olduğu için `isPaidActive` true kalır; müşteriye "Aktif" demek
    // yaklaşan kapanmayı gizlerdi.
    expect(subscriptionBadge(view({ isPaidActive: true, cancelAtPeriodEnd: true }))).toEqual({
      variant: "bekliyor",
      text: "Dönem sonunda iptal",
    })
  })

  it("hoşgörü, aktiflikten ÖNCE sorulur", () => {
    // Bu testin tuttuğu şey sıradır: `isPaidActive` önce sorulsaydı ödemesi alınamamış
    // müşteri yeşil "Aktif" görür, kapanmaya gün saydığını fark etmezdi.
    expect(subscriptionBadge(view({ isInGrace: true, isPaidActive: true }))).toEqual({
      variant: "gecikti",
      text: "Ödeme bekleniyor",
    })
  })

  it("deneme sürümü ücretli aktiflikle karışmaz", () => {
    expect(subscriptionBadge(view({ isTrialActive: true }))).toEqual({
      variant: "aktif",
      text: "Deneme sürümü",
    })
  })

  it("hiçbiri değilse süresi dolmuştur", () => {
    expect(subscriptionBadge(view())).toEqual({ variant: "gecikti", text: "Süresi doldu" })
  })
})

describe("quotaHint", () => {
  it("aboneliksiz hesapta 'hakkınız 0' demez, sebebi söyler", () => {
    expect(quotaHint({ hasActiveSubscription: false, remaining: 0 })).toContain("mevcutlar duruyor")
  })

  it("hak varsa kaç tane kaldığını söyler", () => {
    expect(quotaHint({ hasActiveSubscription: true, remaining: 2 })).toBe(
      "2 tane daha açabilirsiniz.",
    )
  })

  it("hak bittiyse dolu olduğunu söyler", () => {
    expect(quotaHint({ hasActiveSubscription: true, remaining: 0 })).toBe(
      "Hakkınızın tamamı kullanımda.",
    )
  })
})
