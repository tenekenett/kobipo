/**
 * Panonun karşılama ekranı kararı. İki sebebi (arşiv / kilit) ayrı tutmak şart:
 * 2026-09-05'ten önce arşiv ekranı kilidin İÇİNDE yaşıyordu ve ölçü değişince arşivdeki
 * firma "verileriniz duruyor" mesajını hiç görmeyecekti.
 */

import { describe, expect, it } from "vitest"
import { MODULE_KEYS } from "@/lib/modules"
import { lockedScreenFor } from "./locked"

const company = (over: Partial<Parameters<typeof lockedScreenFor>[0]> = {}) => ({
  href: "firma-1",
  role: "ADMIN",
  disabledModules: [] as string[],
  isArchived: false,
  ...over,
})

describe("lockedScreenFor", () => {
  it("çalışan firmada ekran BASILMAZ", () => {
    expect(lockedScreenFor(company({ disabledModules: ["restaurant"] }))).toBeNull()
  })

  it("hiç açık modülü olmayan firmada kilit ekranı", () => {
    const out = lockedScreenFor(company({ disabledModules: [...MODULE_KEYS] }))
    expect(out).toEqual({ companyId: "firma-1", canPurchase: true, isArchived: false })
  })

  it("ARŞİV, modülleri açık olsa bile kendi ekranını gösterir", () => {
    // Kritik: arşiv kilide bağlanırsa temel modülleri açık olan arşivdeki firma
    // "verileriniz duruyor, indirebilirsiniz" mesajını hiç görmez.
    const out = lockedScreenFor(company({ isArchived: true, disabledModules: [] }))
    expect(out?.isArchived).toBe(true)
  })

  it("satın alma yetkisi yalnız ADMIN'de", () => {
    const out = lockedScreenFor(company({ role: "SALES", disabledModules: [...MODULE_KEYS] }))
    expect(out?.canPurchase).toBe(false)
  })
})
