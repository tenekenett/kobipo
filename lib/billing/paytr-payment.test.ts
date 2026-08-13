/**
 * Ödeme sonrası abonelik yazımı kararının testleri.
 *
 * Buradaki bir hata doğrudan müşterinin parasına ve erişimine dokunuyor: canlıda
 * modülsüz (yalnız şube kotası) bir sipariş `applyEntitlements(root, [])` çağırıp
 * ana firma ile TÜM şubelerin her modülünü kapatıyordu. Testler o senaryoyu ve
 * "ödenmiş süre kısalmasın" kuralını kilitliyor.
 */

import { describe, expect, it } from "vitest"
import { planSubscriptionWrite } from "./paytr-payment"

const NOW = new Date("2026-08-13T12:00:00.000Z")

const order = (over: Partial<Parameters<typeof planSubscriptionWrite>[0]> = {}) => ({
  resolvedModules: ["sales", "stock"],
  branchQuota: 0,
  billingCycle: "MONTHLY",
  ...over,
})

describe("planSubscriptionWrite — yalnız şube kotası satın alma", () => {
  it("mevcut abonelikte modüllere ve döneme DOKUNMAZ, sadece kotayı yazar", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 3 }),
      { purchasedModules: ["sales", "stock"], periodEnd: new Date("2026-12-01T00:00:00.000Z") },
      NOW,
    )
    expect(write).toEqual({ kind: "quota-top-up", branchQuota: 3 })
  })

  it("deneme aboneliğinin süresini kısaltmaz (kota takviyesi dönemi hiç yazmaz)", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 11 }),
      { purchasedModules: [], periodEnd: new Date("2027-04-29T00:00:00.000Z") },
      NOW,
    )
    expect(write.kind).toBe("quota-top-up")
  })

  it("aboneliği olmayan hesapta satır açar ama MODÜL YETKİSİ UYGULAMAZ", () => {
    const write = planSubscriptionWrite(order({ resolvedModules: [], branchQuota: 2 }), null, NOW)
    expect(write).toMatchObject({
      kind: "activate",
      purchasedModules: [],
      branchQuota: 2,
      applyEntitlements: false,
    })
  })
})

describe("planSubscriptionWrite — modül/paket satın alma", () => {
  it("modülleri yazar ve yetkileri uygular", () => {
    const write = planSubscriptionWrite(order({ branchQuota: 1 }), null, NOW)
    expect(write).toMatchObject({
      kind: "activate",
      purchasedModules: ["sales", "stock"],
      branchQuota: 1,
      applyEntitlements: true,
    })
  })

  it("periodEnd'i geriye çekmez — dönem ortasında yükseltmede kalan süre korunur", () => {
    const laterEnd = new Date("2027-01-01T00:00:00.000Z")
    const write = planSubscriptionWrite(
      order(),
      { purchasedModules: ["sales"], periodEnd: laterEnd },
      NOW,
    )
    expect(write.kind === "activate" && write.periodEnd).toEqual(laterEnd)
  })

  it("mevcut dönem geçmişse yeni dönemi yazar (aylık → +1 ay)", () => {
    const write = planSubscriptionWrite(
      order(),
      { purchasedModules: ["sales"], periodEnd: new Date("2026-07-01T00:00:00.000Z") },
      NOW,
    )
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2026-09-13T12:00:00.000Z"),
    )
  })

  it("yıllık periyotta dönemi +1 yıl uzatır", () => {
    const write = planSubscriptionWrite(order({ billingCycle: "YEARLY" }), null, NOW)
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2027-08-13T12:00:00.000Z"),
    )
  })

  it("siparişte olmayan mevcut modülleri düşen olarak raporlar", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: ["sales"] }),
      { purchasedModules: ["sales", "stock", "hr"], periodEnd: null },
      NOW,
    )
    expect(write.kind === "activate" && write.droppedModules).toEqual(["stock", "hr"])
  })

  it("bilinmeyen periyot aylığa düşer", () => {
    const write = planSubscriptionWrite(order({ billingCycle: "HAFTALIK" }), null, NOW)
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2026-09-13T12:00:00.000Z"),
    )
  })
})
