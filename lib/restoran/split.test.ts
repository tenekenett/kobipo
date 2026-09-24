import { describe, expect, it } from "vitest"
import { grossOf, parseSplitParts, planTicketSplit, splitTicketDiscount } from "@/lib/restoran/split"

const items = [
  { id: "cay", quantity: 3, status: "NORMAL", unitPrice: 25, vatRate: 10 },
  { id: "tost", quantity: 1, status: "NORMAL", unitPrice: 100, vatRate: 10 },
  { id: "ikram", quantity: 1, status: "COMP", unitPrice: 40, vatRate: 10 },
]

describe("parseSplitParts", () => {
  it("geçerli gövdeyi okur, miktarı 4 haneye yuvarlar", () => {
    expect(parseSplitParts({ parts: [{ items: [{ itemId: "cay", quantity: "1.00001" }] }] })).toEqual([
      { items: [{ itemId: "cay", quantity: 1 }] },
    ])
  })
  it("boş parça ve sıfır miktarı reddeder", () => {
    expect(typeof parseSplitParts({ parts: [] })).toBe("string")
    expect(typeof parseSplitParts({ parts: [{ items: [] }] })).toBe("string")
    expect(typeof parseSplitParts({ parts: [{ items: [{ itemId: "cay", quantity: 0 }] }] })).toBe("string")
  })
})

describe("planTicketSplit", () => {
  it("adet bölme: 3 çaydan 1'i yeni satır, kaynakta 2 kalır", () => {
    const plan = planTicketSplit(items, [{ items: [{ itemId: "cay", quantity: 1 }] }])
    expect(plan).toEqual({
      ok: true,
      moves: [{ partIndex: 0, itemId: "cay", quantity: 1, reuseRow: false }],
      sourceRemaining: { cay: 2 },
    })
  })

  it("kalemin tamamı taşınırsa satırın kendisi geçer", () => {
    const plan = planTicketSplit(items, [{ items: [{ itemId: "tost", quantity: 1 }] }])
    expect(plan.ok && plan.moves[0].reuseRow).toBe(true)
    expect(plan.ok && plan.sourceRemaining.tost).toBe(0)
  })

  it("iki parça bir kalemi paylaşıp bitirirse yalnız SON pay satırı alır", () => {
    const plan = planTicketSplit(items, [
      { items: [{ itemId: "cay", quantity: 1 }] },
      { items: [{ itemId: "cay", quantity: 2 }] },
    ])
    expect(plan.ok && plan.moves.map((m) => m.reuseRow)).toEqual([false, true])
  })

  it("miktarı aşan toplam reddedilir", () => {
    const plan = planTicketSplit(items, [
      { items: [{ itemId: "cay", quantity: 2 }] },
      { items: [{ itemId: "cay", quantity: 2 }] },
    ])
    expect(plan.ok).toBe(false)
  })

  it("ikram kalemi taşınamaz, bilinmeyen kalem reddedilir", () => {
    expect(planTicketSplit(items, [{ items: [{ itemId: "ikram", quantity: 1 }] }]).ok).toBe(false)
    expect(planTicketSplit(items, [{ items: [{ itemId: "yok", quantity: 1 }] }]).ok).toBe(false)
  })

  it("kaynakta ödenecek kalem kalmıyorsa reddedilir (ikram sayılmaz)", () => {
    const plan = planTicketSplit(items, [
      {
        items: [
          { itemId: "cay", quantity: 3 },
          { itemId: "tost", quantity: 1 },
        ],
      },
    ])
    expect(plan.ok).toBe(false)
  })
})

describe("splitTicketDiscount", () => {
  it("yüzde her hesaba aynen gider", () => {
    const d = splitTicketDiscount({ type: "PERCENT", value: 10 }, 100, [50, 50])
    expect(d.source).toEqual({ type: "PERCENT", value: 10 })
    expect(d.parts).toEqual([
      { type: "PERCENT", value: 10 },
      { type: "PERCENT", value: 10 },
    ])
  })

  it("tutar brüt oranında dağılır, kuruş kalanı kaynakta, toplam korunur", () => {
    const d = splitTicketDiscount({ type: "AMOUNT", value: 10 }, 100, [100, 100])
    // 10 / 3 = 3,33 · 3,33 · kaynak 3,34
    expect(d.parts).toEqual([
      { type: "AMOUNT", value: 3.33 },
      { type: "AMOUNT", value: 3.33 },
    ])
    expect(d.source).toEqual({ type: "AMOUNT", value: 3.34 })
  })

  it("iskonto yoksa hiçbir hesaba iskonto yazılmaz", () => {
    expect(splitTicketDiscount(null, 100, [20])).toEqual({ source: null, parts: [null] })
  })

  it("hesabı aşan tutar kırpılır (ekrandaki kuralla aynı)", () => {
    const d = splitTicketDiscount({ type: "AMOUNT", value: 500 }, 100, [100])
    expect((d.source?.value ?? 0) + (d.parts[0]?.value ?? 0)).toBe(200)
  })
})

describe("grossOf", () => {
  it("KDV dahil iskonto öncesi tutar", () => {
    expect(grossOf([{ quantity: 2, unitPrice: 25, vatRate: 10 }])).toBeCloseTo(55, 6)
  })
})
