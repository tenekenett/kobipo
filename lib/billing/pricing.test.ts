/**
 * Sipariş tutarı hesabının testleri — odak: TEMEL (ücretsiz) modüller.
 *
 * Buradaki hatalar iki yöne düşüyor ve ikisi de sessiz:
 *  - ücretsiz modül ücretlendirilirse müşteri bedava olması gereken şeye para öder,
 *  - ücretsiz modül `resolvedModules`a girerse "satın alınmış" sayılır ve sistem
 *    yöneticisi onu sonradan ücretliye çevirdiğinde o hesapta bedava açık kalır
 *    (`Subscription.purchasedModules` bu alandan yazılıyor, bkz. lib/billing/paytr-payment.ts).
 */

import { describe, expect, it } from "vitest"
import { computeOrder } from "./pricing"
import type { PricingMap } from "./pricing"

const pricing: PricingMap = {
  "module:sales": { monthlyPrice: 100, yearlyPrice: 1000 },
  "module:stock": { monthlyPrice: 200, yearlyPrice: 2000 },
  "module:restaurant": { monthlyPrice: 300, yearlyPrice: 3000 },
  branch: { monthlyPrice: 50, yearlyPrice: 500 },
  company: { monthlyPrice: 80, yearlyPrice: 800 },
}

const base = {
  plan: null,
  branchQuota: 0,
  companyQuota: 0,
  billingCycle: "MONTHLY" as const,
  pricing,
}

describe("computeOrder — ücretsiz modüller", () => {
  it("ücretsiz modül seçilse bile ücretlendirilmez", () => {
    const out = computeOrder({ ...base, chosenModules: ["sales"], freeModules: ["sales"] })
    expect(out.amount).toBe(0)
    expect(out.lines).toEqual([])
    expect(out.extraModules).toEqual([])
    expect(out.freeModules).toEqual(["sales"])
  })

  it("ücretsiz modül SATIN ALINAN kümeye (resolvedModules) girmez", () => {
    // Girseydi purchasedModules'a yazılır, ücretliye dönünce hesapta bedava kalırdı.
    const out = computeOrder({ ...base, chosenModules: ["sales"], freeModules: ["sales"] })
    expect(out.resolvedModules).toEqual([])
  })

  it("ücretli modül normal ücretlendirilir, ücretsiz olan yanında bedavadır", () => {
    const out = computeOrder({
      ...base,
      chosenModules: ["sales", "stock"],
      freeModules: ["sales"],
    })
    expect(out.amount).toBe(200)
    expect(out.extraModules).toEqual(["stock"])
    expect(out.resolvedModules).toEqual(["stock"])
  })

  it("ücretli modülün ÜCRETSİZ bağımlılığı satırlara girmez", () => {
    // Restoran & Kafe → Stok. Stok ücretsizse yalnız restoran ücretlendirilir;
    // stok yine açılır, çünkü resolveGrantedModules bağımlılıkları tamamlıyor.
    const out = computeOrder({
      ...base,
      chosenModules: ["restaurant"],
      freeModules: ["stock"],
    })
    expect(out.amount).toBe(300)
    expect(out.lines.map((l) => l.key)).toEqual(["module:restaurant"])
    expect(out.resolvedModules).toEqual(["restaurant"])
  })

  it("PAKETE DAHİL modül ücretsiz olsa da satın alınan kümede kalır", () => {
    // Bedeli paket fiyatına dahil; ücretsizlik kalkarsa müşteri hakkını kaybetmemeli.
    const out = computeOrder({
      ...base,
      plan: {
        id: "p1",
        name: "Başlangıç",
        monthlyPrice: 500,
        yearlyPrice: 5000,
        includedModules: ["sales", "stock"],
        includedBranches: 0,
        includedCompanies: 0,
      },
      chosenModules: [],
      freeModules: ["sales"],
    })
    expect(out.amount).toBe(500)
    expect([...out.resolvedModules].sort()).toEqual(["sales", "stock"])
  })

  it("bağımlılığı ücretli olan anahtar ücretsiz sayılmaz (ikinci savunma)", () => {
    // Restoran ücretsiz işaretlense de Stok ücretliyken geçersizdir; aksi halde
    // bağımlılık tamamlama stoğu da bedavaya açardı.
    const out = computeOrder({
      ...base,
      chosenModules: ["restaurant"],
      freeModules: ["restaurant"],
    })
    expect(out.freeModules).toEqual([])
    expect(out.amount).toBe(500) // restaurant 300 + bağımlılık stock 200
  })

  it("ücretsiz küme verilmezse davranış eskisiyle aynıdır", () => {
    const out = computeOrder({ ...base, chosenModules: ["sales"] })
    expect(out.amount).toBe(100)
    expect(out.resolvedModules).toEqual(["sales"])
  })

  it("kota kalemleri ücretsizlikten etkilenmez", () => {
    const out = computeOrder({
      ...base,
      chosenModules: ["sales"],
      branchQuota: 2,
      companyQuota: 1,
      freeModules: ["sales"],
    })
    expect(out.amount).toBe(2 * 50 + 80)
  })
})
