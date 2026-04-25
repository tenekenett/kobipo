export type CheckoutSession = {
  url: string
  provider: "stripe" | "iyzico"
}

export async function createCheckoutSession(provider: "stripe" | "iyzico", planCode: string): Promise<CheckoutSession> {
  // Bu sürümde gerçek SDK yerine provider checkout URL'sine yönlendirme üretiliyor.
  const base = provider === "stripe" ? "https://checkout.stripe.com/pay" : "https://www.iyzico.com/odeme"
  return { provider, url: `${base}?plan=${encodeURIComponent(planCode)}` }
}
