import { describe, expect, it } from "vitest"
import {
  UNCATEGORIZED_LABEL,
  UNTAGGED_LABEL,
  buildBreakdowns,
  type ClassifiedEntry,
} from "./gelir-gider-kirilim"

function entry(over: Partial<ClassifiedEntry> = {}): ClassifiedEntry {
  return {
    direction: "revenue",
    amount: 1_000,
    category: "Danışmanlık",
    tags: [],
    month: "2026-09",
    partyKey: null,
    partyLabel: null,
    partyRef: null,
    partyKind: null,
    count: 1,
    ...over,
  }
}

describe("gelir-gider kırılımı", () => {
  it("gelir ve gideri ayrı toplar, kârı farktan bulur", () => {
    const result = buildBreakdowns([
      entry({ direction: "revenue", amount: 10_000 }),
      entry({ direction: "expense", amount: 4_000, category: "Kira" }),
    ])

    expect(result.totals.revenue).toBe(10_000)
    expect(result.totals.expense).toBe(4_000)
    expect(result.totals.profit).toBe(6_000)
    expect(result.totals.marginPct).toBe(60)
  })

  /** Ciro yokken "%0 marj" yazmak, zarar eden firmayı başabaş gösterirdi. */
  it("ciro sıfırsa marj oranı yoktur", () => {
    const result = buildBreakdowns([entry({ direction: "expense", amount: 500 })])
    expect(result.totals.marginPct).toBeNull()
  })

  /**
   * İade kendi ailesinin EKSİSİDİR: satış iadesi ciroyu azaltır, ayrı bir gider
   * kalemi olmaz. Aksi halde geri gelen mal hem satılmış hem gider görünürdü.
   */
  it("satış iadesi ciroyu azaltır, gidere yazılmaz", () => {
    const result = buildBreakdowns([
      entry({ direction: "revenue", amount: 10_000, category: "Ürün satışı" }),
      entry({ direction: "revenue", amount: -2_000, category: "Ürün satışı" }),
    ])

    expect(result.totals.revenue).toBe(8_000)
    expect(result.totals.expense).toBe(0)
    expect(result.byCategory).toHaveLength(1)
    expect(result.byCategory[0]).toMatchObject({ label: "Ürün satışı", revenue: 8_000 })
  })

  it("kategorisiz belgeler kendi satırında toplanır", () => {
    const result = buildBreakdowns([
      entry({ category: null, amount: 300 }),
      entry({ category: "   ", amount: 700 }),
      entry({ category: "Kira", direction: "expense", amount: 1_500 }),
    ])

    const uncategorized = result.byCategory.find((row) => row.label === UNCATEGORIZED_LABEL)
    expect(uncategorized).toMatchObject({ revenue: 1_000, count: 2 })
  })

  it("kategori satırları hacme göre sıralanır", () => {
    const result = buildBreakdowns([
      entry({ category: "Küçük", amount: 100 }),
      entry({ category: "Büyük", amount: 9_000 }),
      entry({ category: "Orta", amount: 3_000 }),
    ])
    expect(result.byCategory.map((row) => row.label)).toEqual(["Büyük", "Orta", "Küçük"])
  })
})

/**
 * Etiket ekseni ÇOKLUDUR: bir belge üç etikete de tam tutarıyla girer. Bu
 * kaçınılmaz (Paraşüt'te de öyle) ama ekran uyarmak zorunda — burada nöbet
 * tutan şey, davranışın kazara değişmemesi.
 */
describe("etiket ekseni", () => {
  it("belge her etikete TAM tutarıyla girer; satır toplamı geneli aşabilir", () => {
    const result = buildBreakdowns([
      entry({ amount: 1_000, tags: ["Proje A", "İstanbul"] }),
    ])

    expect(result.totals.revenue).toBe(1_000)
    expect(result.byTag).toHaveLength(2)
    expect(result.byTag.every((row) => row.revenue === 1_000)).toBe(true)
  })

  it("aynı etiket iki kez yazılmışsa bir kez sayılır", () => {
    const result = buildBreakdowns([entry({ amount: 500, tags: ["Proje A", "Proje A"] })])
    expect(result.byTag).toHaveLength(1)
    expect(result.byTag[0]).toMatchObject({ label: "Proje A", revenue: 500, count: 1 })
  })

  it("etiketsiz belgeler kendi satırında toplanır", () => {
    const result = buildBreakdowns([entry({ amount: 800, tags: [] })])
    expect(result.byTag[0].label).toBe(UNTAGGED_LABEL)
  })
})

describe("cari ekseni", () => {
  it("carisiz belge (perakende satış) cari kırılımına girmez", () => {
    const result = buildBreakdowns([
      entry({ amount: 1_000, partyKey: null }),
      entry({
        amount: 2_000,
        partyKey: "cus-1",
        partyLabel: "ACME",
        partyRef: "acme",
        partyKind: "customer",
      }),
    ])

    expect(result.byParty).toHaveLength(1)
    expect(result.byParty[0]).toMatchObject({ label: "ACME", ref: "acme", kind: "customer" })
    // Genel toplam yine ikisini de içerir — cari kırılımına girmemek "sayılmamak" değil.
    expect(result.totals.revenue).toBe(3_000)
  })

  it("müşteri ve tedarikçi satırları kendi yönünü taşır", () => {
    const result = buildBreakdowns([
      entry({
        direction: "expense",
        amount: 5_000,
        partyKey: "sup-1",
        partyLabel: "Tedarik A.Ş.",
        partyRef: "tedarik-as",
        partyKind: "supplier",
      }),
    ])
    expect(result.byParty[0]).toMatchObject({ kind: "supplier", expense: 5_000 })
  })
})

describe("aylık eksen", () => {
  it("tutara göre değil TARİHE göre sıralanır", () => {
    const result = buildBreakdowns([
      entry({ month: "2026-09", amount: 100 }),
      entry({ month: "2026-07", amount: 9_000 }),
      entry({ month: "2026-08", amount: 500 }),
    ])
    expect(result.byMonth.map((row) => row.key)).toEqual(["2026-07", "2026-08", "2026-09"])
  })

  it("aylık gelir toplamı genel toplamı tutar", () => {
    const result = buildBreakdowns([
      entry({ month: "2026-07", amount: 1_000 }),
      entry({ month: "2026-08", amount: 2_000 }),
      entry({ month: "2026-08", direction: "expense", amount: 750 }),
    ])
    const sum = result.byMonth.reduce((acc, row) => acc + row.revenue - row.expense, 0)
    expect(sum).toBe(result.totals.profit)
  })
})
