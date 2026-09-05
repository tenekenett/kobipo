import { describe, expect, it } from "vitest"
import {
  buildCashProjection,
  startOfWeek,
  type ProjectionItem,
} from "./nakit-projeksiyon-kova"

function item(over: Partial<ProjectionItem> = {}): ProjectionItem {
  return { dueDate: "2026-09-10", amount: 1_000, direction: "in", hasDueDate: true, ...over }
}

/** Cumartesi 5 Eylül 2026 — hafta başı 31 Ağustos Pazartesi. */
const TODAY = new Date(2026, 8, 5)

describe("hafta başı", () => {
  it("pazartesiyi verir", () => {
    expect(startOfWeek(new Date(2026, 8, 5))).toEqual(new Date(2026, 7, 31))
    expect(startOfWeek(new Date(2026, 7, 31))).toEqual(new Date(2026, 7, 31))
  })

  /**
   * `getDay()` pazarı 0 verir; çıplak `-getDay()` pazar gününü kendi haftasının
   * başı sayıp haftayı altı gün ileri kaydırırdı.
   */
  it("pazar günü haftayı ileri kaydırmaz", () => {
    expect(startOfWeek(new Date(2026, 8, 6))).toEqual(new Date(2026, 7, 31))
  })
})

describe("nakit projeksiyonu", () => {
  it("kümülatif bakiye açılıştan başlayıp her kovada net kadar ilerler", () => {
    const projection = buildCashProjection({
      today: TODAY,
      openingBalance: 10_000,
      granularity: "week",
      bucketCount: 3,
      // 6 Eylül = bulunduğumuz haftanın (31 Ağu-6 Eyl) son günü → 1. kova.
      // 9 Eylül → 2. kova (7-13 Eyl). 2 Eylül seçilseydi vadesi GEÇMİŞ olurdu.
      items: [
        item({ dueDate: "2026-09-06", amount: 5_000, direction: "in" }),
        item({ dueDate: "2026-09-09", amount: 3_000, direction: "out" }),
      ],
    })

    expect(projection.buckets).toHaveLength(3)
    expect(projection.buckets[0]).toMatchObject({ inflow: 5_000, outflow: 0, balance: 15_000 })
    expect(projection.buckets[1]).toMatchObject({ inflow: 0, outflow: 3_000, balance: 12_000 })
    expect(projection.buckets[2]).toMatchObject({ net: 0, balance: 12_000 })
  })

  /**
   * En kritik kural: aylardır tahsil edilememiş para "bugün geliyor" sayılırsa
   * projeksiyon darboğazı tam da darboğazdaki firmada gizler.
   */
  it("vadesi geçmiş tutar eğriye girmez, ayrı durur", () => {
    const projection = buildCashProjection({
      today: TODAY,
      openingBalance: 0,
      granularity: "week",
      bucketCount: 4,
      items: [item({ dueDate: "2026-06-01", amount: 50_000, direction: "in" })],
    })

    expect(projection.overdue.inflow).toBe(50_000)
    expect(projection.buckets.every((bucket) => bucket.inflow === 0)).toBe(true)
    expect(projection.buckets[3].balance).toBe(0)
  })

  it("vadesi tanımsız tutar da eğriye girmez", () => {
    const projection = buildCashProjection({
      today: TODAY,
      openingBalance: 1_000,
      granularity: "week",
      bucketCount: 2,
      items: [item({ dueDate: null, hasDueDate: false, amount: 9_000 })],
    })

    expect(projection.undated.inflow).toBe(9_000)
    expect(projection.buckets[1].balance).toBe(1_000)
  })

  it("ufkun ötesindeki vade 'sonrası' toplamına yazılır — kaybolmaz", () => {
    const projection = buildCashProjection({
      today: TODAY,
      openingBalance: 0,
      granularity: "week",
      bucketCount: 2,
      items: [item({ dueDate: "2027-03-01", amount: 4_000, direction: "out" })],
    })

    expect(projection.beyond.outflow).toBe(4_000)
    expect(projection.buckets.every((bucket) => bucket.outflow === 0)).toBe(true)
  })

  it("en düşük noktayı bulur — darboğaz uyarısı buradan çıkar", () => {
    const projection = buildCashProjection({
      today: TODAY,
      openingBalance: 5_000,
      granularity: "week",
      bucketCount: 3,
      items: [
        item({ dueDate: "2026-09-09", amount: 20_000, direction: "out" }),
        item({ dueDate: "2026-09-16", amount: 30_000, direction: "in" }),
      ],
    })

    expect(projection.lowestPoint?.balance).toBe(-15_000)
    expect(projection.buckets[2].balance).toBe(15_000)
  })

  it("aylık kırılımda yıl sınırı aşılır", () => {
    const projection = buildCashProjection({
      today: new Date(2026, 10, 15),
      openingBalance: 0,
      granularity: "month",
      bucketCount: 3,
      items: [item({ dueDate: "2027-01-20", amount: 2_500, direction: "in" })],
    })

    expect(projection.buckets.map((bucket) => bucket.key)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ])
    expect(projection.buckets[2].inflow).toBe(2_500)
  })

  it("hafta etiketi ay sınırını aşınca iki ayı da yazar", () => {
    const projection = buildCashProjection({
      today: new Date(2026, 8, 29),
      openingBalance: 0,
      granularity: "week",
      bucketCount: 1,
      items: [],
    })
    // 28 Eylül Pazartesi — 4 Ekim Pazar.
    expect(projection.buckets[0].label).toBe("28 Eyl-4 Eki")
    expect(projection.buckets[0].startDate).toBe("2026-09-28")
    expect(projection.buckets[0].endDate).toBe("2026-10-04")
  })

  it("kapanmış (sıfır tutarlı) kalem kova açmaz", () => {
    const projection = buildCashProjection({
      today: TODAY,
      openingBalance: 0,
      granularity: "week",
      bucketCount: 2,
      items: [item({ amount: 0 })],
    })
    expect(projection.buckets.every((bucket) => bucket.inflow === 0)).toBe(true)
    expect(projection.overdue.inflow).toBe(0)
  })
})
