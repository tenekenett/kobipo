/**
 * Panodaki tanıtım şeridinin "satıştaki modül" ölçüsü. Kaynak sistem yönetimindeki
 * Paket & Fiyat ayarıdır: "Aktif" olmayan modül duyurulmaz (2026-10-06: satışa açılmamış
 * Muhasebe tüm firmalara "satın alın" diye duyuruluyordu).
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { sellableModulesFromPricingItems } from "./free-modules"

describe("sellableModulesFromPricingItems", () => {
  it("yalnız Aktif ve ücretli modül kalemleri satıştadır", () => {
    expect(
      sellableModulesFromPricingItems([
        { key: "module:restaurant", isActive: true, isFree: false },
        { key: "module:accounting", isActive: false, isFree: false }, // pilot öncesi, satışta değil
        { key: "module:sales", isActive: true, isFree: true }, // temel: satılmaz
      ]),
    ).toEqual(["restaurant"])
  })

  it("modül olmayan kalem ve bilinmeyen modül anahtarı sayılmaz", () => {
    expect(
      sellableModulesFromPricingItems([
        { key: "branch", isActive: true, isFree: false },
        { key: "module:yok-boyle", isActive: true, isFree: false },
      ]),
    ).toEqual([])
  })
})
