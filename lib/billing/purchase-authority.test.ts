import { describe, expect, it } from "vitest"
import { resolvePurchaseAuthority, type PurchaseAuthorityFacts } from "./purchase-authority"

const facts = (over: Partial<PurchaseAuthorityFacts> = {}): PurchaseAuthorityFacts => ({
  companyRole: "ADMIN",
  isAccountRoot: true,
  isSuperAdmin: false,
  isAccountRootAdmin: false,
  ...over,
})

describe("resolvePurchaseAuthority", () => {
  it("kökün ADMIN'i satın alabilir", () => {
    expect(resolvePurchaseAuthority(facts())).toEqual({ ok: true, reason: null })
  })

  it("ADMIN olmayan satın ALAMAZ — kökün kendi ekranında bile", () => {
    // Abonelik sayfası özel rollere açılabiliyor: görmek ödemek değildir. Bu dal
    // 2026-09-04'e kadar `catalog/route.ts`te yoktu ve düğme açık geliyordu.
    const r = resolvePurchaseAuthority(facts({ companyRole: "VIEWER" }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe("not-admin")
  })

  it("üyeliği olmayan (rol null) satın alamaz", () => {
    expect(resolvePurchaseAuthority(facts({ companyRole: null })).ok).toBe(false)
  })

  it("ADMIN olmama, süper-admin olsa bile 1. katmanı atlatmaz", () => {
    // Süper-admin yalnız HESAP katmanını atlar; firmada ADMIN üyeliği yoksa uç da
    // (orders/route.ts) 403 döndürüyor — ekran onunla aynı cevabı vermeli.
    const r = resolvePurchaseAuthority(facts({ companyRole: "VIEWER", isSuperAdmin: true }))
    expect(r.ok === false && r.reason).toBe("not-admin")
  })

  it("şubeye atanmış ADMIN, hesap kökünün ADMIN'i değilse satın alamaz", () => {
    const r = resolvePurchaseAuthority(facts({ isAccountRoot: false }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe("not-account-admin")
  })

  it("şubede ADMIN + kökte ADMIN → satın alabilir", () => {
    expect(
      resolvePurchaseAuthority(facts({ isAccountRoot: false, isAccountRootAdmin: true })).ok,
    ).toBe(true)
  })

  it("süper-admin hesap katmanını atlar", () => {
    expect(resolvePurchaseAuthority(facts({ isAccountRoot: false, isSuperAdmin: true })).ok).toBe(
      true,
    )
  })
})
