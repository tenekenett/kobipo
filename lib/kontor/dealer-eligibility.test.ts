import { describe, expect, it } from "vitest"
import { findDealerTenant, resolveKontorTargetVkn } from "./dealer-eligibility"

const list = [
  { tenantName: "REYPO BİLİŞİM", vknTckn: "7352344835" },
  { tenantName: "EREN VİNÇ", vknTckn: "3530589517" },
  { tenantName: "PASİF A.Ş.", vknTckn: "1111111111", isPassive: true },
]

describe("findDealerTenant", () => {
  it("bayi altındaki aktif mükellefi bulur", () => {
    expect(findDealerTenant(list, "7352344835")?.tenantName).toBe("REYPO BİLİŞİM")
  })
  it("listede olmayan VKN'yi (Eren Forklift 3531285187) bulmaz", () => {
    expect(findDealerTenant(list, "3531285187")).toBeNull()
  })
  it("pasif mükellefe yükleme yapılmaz", () => {
    expect(findDealerTenant(list, "1111111111")).toBeNull()
  })
  it("boşluk/ayraç farkını yok sayar, boş VKN'de null döner", () => {
    expect(findDealerTenant([{ vknTckn: " 353 058 9517 " }], "3530589517")).not.toBeNull()
    expect(findDealerTenant(list, "")).toBeNull()
  })
})

describe("resolveKontorTargetVkn", () => {
  it("eDonusumTenantVkn önce, sonra taxNumber", () => {
    expect(resolveKontorTargetVkn({ eDonusumTenantVkn: "3531285187", taxNumber: "9999999999" })).toBe("3531285187")
    expect(resolveKontorTargetVkn({ eDonusumTenantVkn: null, taxNumber: "735 234 4835" })).toBe("7352344835")
  })
  it("10/11 hane dışını reddeder", () => {
    expect(resolveKontorTargetVkn({ taxNumber: "123" })).toBeNull()
    expect(resolveKontorTargetVkn(null)).toBeNull()
  })
})
