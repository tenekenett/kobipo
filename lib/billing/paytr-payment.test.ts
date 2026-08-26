/**
 * Ödeme sonrası abonelik yazımı kararının testleri.
 *
 * Buradaki bir hata doğrudan müşterinin parasına ve erişimine dokunuyor: canlıda
 * modülsüz (yalnız kota) bir sipariş `applyEntitlements(root, [])` çağırıp kök firma
 * ile hesabın TÜM üyelerinin her modülünü kapatıyordu. Testler o senaryoyu, iki
 * kotanın (şube/firma) birbirini ezmemesini ve "ödenmiş süre kısalmasın" kuralını
 * kilitliyor.
 */

import { describe, expect, it } from "vitest"
import { planSubscriptionWrite } from "./paytr-payment"

const NOW = new Date("2026-08-13T12:00:00.000Z")

const order = (over: Partial<Parameters<typeof planSubscriptionWrite>[0]> = {}) => ({
  resolvedModules: ["sales", "stock"],
  branchQuota: 0,
  companyQuota: 0,
  billingCycle: "MONTHLY",
  ...over,
})

describe("planSubscriptionWrite — yalnız kota satın alma", () => {
  it("mevcut abonelikte modüllere ve döneme DOKUNMAZ, sadece kotayı yazar", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 3 }),
      { purchasedModules: ["sales", "stock"], periodEnd: new Date("2026-12-01T00:00:00.000Z") },
      NOW,
    )
    expect(write).toEqual({ kind: "quota-top-up", branchQuota: 3, companyQuota: 0 })
  })

  // Firma kotası şubeden AYRI bir üründür: modülsüz "bir firma daha" siparişi de
  // kota takviyesi sayılmalı, yoksa aboneliği ACTIVE'e alıp modülleri sıfırlardı.
  it("yalnız FİRMA kotası alındığında da kota takviyesi yapar", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], companyQuota: 2 }),
      { purchasedModules: ["sales"], periodEnd: new Date("2026-12-01T00:00:00.000Z") },
      NOW,
    )
    expect(write).toEqual({ kind: "quota-top-up", branchQuota: 0, companyQuota: 2 })
  })

  it("iki kotayı birlikte yazar — biri diğerini sıfırlamaz", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 4, companyQuota: 1 }),
      { purchasedModules: [], periodEnd: null },
      NOW,
    )
    expect(write).toEqual({ kind: "quota-top-up", branchQuota: 4, companyQuota: 1 })
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
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 2, companyQuota: 1 }),
      null,
      NOW,
    )
    expect(write).toMatchObject({
      kind: "activate",
      purchasedModules: [],
      branchQuota: 2,
      companyQuota: 1,
      applyEntitlements: false,
    })
  })
})

describe("planSubscriptionWrite — modülsüz sipariş yetki YAZAMAZ", () => {
  // Canlıda yaşandı: `companyQuota`yı bilmeyen bir sürüm, yalnız firma kotası içeren
  // siparişi "modül alımı" sanıp `applyEntitlements(root, [])` çağırdı ve hesabın tüm
  // modüllerini kapattı. Kota koşulu ileride yine eksik kalabilir; bu test, modülsüz
  // hiçbir siparişin yetkiye dokunamayacağını kilitler.
  it("hiçbir kota koşuluna uymasa bile applyEntitlements=false kalır", () => {
    const write = planSubscriptionWrite(
      order({ resolvedModules: [], branchQuota: 0, companyQuota: 0 }),
      { purchasedModules: ["sales", "stock"], periodEnd: null },
      NOW,
    )
    expect(write).toMatchObject({ kind: "activate", applyEntitlements: false })
  })
})

describe("planSubscriptionWrite — modül/paket satın alma", () => {
  it("modülleri yazar ve yetkileri uygular", () => {
    const write = planSubscriptionWrite(order({ branchQuota: 1, companyQuota: 2 }), null, NOW)
    expect(write).toMatchObject({
      kind: "activate",
      purchasedModules: ["sales", "stock"],
      branchQuota: 1,
      companyQuota: 2,
      applyEntitlements: true,
    })
  })

  it("dönem GELECEKTEYSE onun üstüne ekler — erken yenileyen gün kaybetmez", () => {
    // Eski kural `max(mevcutBitiş, bugün+periyot)` idi ve tam burada para/erişim
    // kaybettiriyordu: 1 Ocak'a kadar süresi olan müşteri bugün aylık yenilerse
    // 13 Eylül'e düşüyordu, yani üç buçuk ayını kaybediyordu.
    const laterEnd = new Date("2027-01-01T00:00:00.000Z")
    const write = planSubscriptionWrite(
      order(),
      { purchasedModules: ["sales"], periodEnd: laterEnd },
      NOW,
    )
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2027-02-01T00:00:00.000Z"),
    )
  })

  it("yıllık erken yenilemede kalan süre korunur", () => {
    const laterEnd = new Date("2026-09-02T00:00:00.000Z") // 20 gün kaldı
    const write = planSubscriptionWrite(
      order({ billingCycle: "YEARLY" }),
      { purchasedModules: ["sales"], periodEnd: laterEnd },
      NOW,
    )
    expect(write.kind === "activate" && write.periodEnd).toEqual(
      new Date("2027-09-02T00:00:00.000Z"),
    )
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
