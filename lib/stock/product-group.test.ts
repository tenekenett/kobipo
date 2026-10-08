import { describe, expect, it } from "vitest"
import {
  PRODUCT_GROUP_NONE,
  groupChips,
  groupWhereValue,
  matchesGroupFilter,
  visibleGroupChips,
} from "./product-group"

describe("groupChips", () => {
  it("sıra tüm listedeki kullanımdan, sayı süzülmüş kümeden gelir", () => {
    const all = ["Bosch", "Makita", "Bosch", null, "Bosch", "Makita", "Arçelik", "  "]
    const scope = ["Makita", null, ""]
    const { chips, noneCount } = groupChips(all, scope)
    expect(chips).toEqual([
      { value: "Bosch", count: 0 },
      { value: "Makita", count: 1 },
      { value: "Arçelik", count: 0 },
    ])
    expect(noneCount).toBe(2)
  })

  it("eşit kullanımda Türkçe alfabe sırası", () => {
    const { chips } = groupChips(["Çelik", "Zeta", "Ceylan"], [])
    expect(chips.map((c) => c.value)).toEqual(["Ceylan", "Çelik", "Zeta"])
  })

  it("kimsede etiket yoksa rozet yok", () => {
    expect(groupChips([null, ""], [null]).chips).toEqual([])
  })
})

describe("visibleGroupChips", () => {
  const chips = ["A", "B", "C", "D"].map((value) => ({ value, count: 1 }))

  it("ilk `limit` rozet", () => {
    expect(visibleGroupChips(chips, "ALL", 2).map((c) => c.value)).toEqual(["A", "B"])
  })

  it("gizli bölümdeki seçili rozet sona eklenir", () => {
    expect(visibleGroupChips(chips, "D", 2).map((c) => c.value)).toEqual(["A", "B", "D"])
  })

  it("görünen bölümdeki seçili rozet tekrarlanmaz", () => {
    expect(visibleGroupChips(chips, "B", 2).map((c) => c.value)).toEqual(["A", "B"])
  })
})

describe("matchesGroupFilter / groupWhereValue", () => {
  it("ALL her şeyi, NONE yalnız boşları geçirir", () => {
    expect(matchesGroupFilter("Bosch", "ALL")).toBe(true)
    expect(matchesGroupFilter(null, PRODUCT_GROUP_NONE)).toBe(true)
    expect(matchesGroupFilter("  ", PRODUCT_GROUP_NONE)).toBe(true)
    expect(matchesGroupFilter("Bosch", PRODUCT_GROUP_NONE)).toBe(false)
    expect(matchesGroupFilter("Bosch", "Bosch")).toBe(true)
    expect(matchesGroupFilter("Makita", "Bosch")).toBe(false)
  })

  it("NONE sunucuda IS NULL olur", () => {
    expect(groupWhereValue(PRODUCT_GROUP_NONE)).toBeNull()
    expect(groupWhereValue("Bosch")).toBe("Bosch")
  })
})
