import { describe, expect, it } from "vitest"
import {
  applyDocumentSales,
  classifyStockFlows,
  type DocFamily,
  type FlowMovement,
} from "@/lib/raporlar/stok-donem-kural"

const families: Record<string, DocFamily> = {
  fatura: "SALES",
  fis: "SALES",
  iade: "SALES", // satış iadesi de satış ailesidir; miktarı + gelir
  alis: "PURCHASE",
  "waybill:1": "WAYBILL",
}
const familyOf = (ref: string): DocFamily => families[ref] ?? "UNKNOWN"
const mv = (m: Partial<FlowMovement> & { quantity: number }): FlowMovement => ({
  productId: "p",
  type: m.quantity > 0 ? "IN" : "OUT",
  ...m,
})

describe("classifyStockFlows", () => {
  it("faturalı ve faturasız satış birlikte sayılır, iade düşer", () => {
    const f = classifyStockFlows(
      [
        mv({ quantity: -5, reference: "fatura" }),
        mv({ quantity: -2, reference: "fis" }),
        mv({ quantity: 1, reference: "iade" }),
        mv({ quantity: -3, reason: "SALE" }),
      ],
      familyOf,
    ).get("p")!
    expect(f.sold).toBe(9)
    expect(f.other).toBe(0)
  })

  it("fire/numune ve nedeni boş eski çıkış satış DEĞİLDİR", () => {
    const f = classifyStockFlows(
      [mv({ quantity: -1, reason: "WASTE" }), mv({ quantity: -2, reason: "SAMPLE" }), mv({ quantity: -4 })],
      familyOf,
    ).get("p")!
    expect(f.sold).toBe(0)
    expect(f.other).toBe(-7)
  })

  it("faturasız giriş ve açılış girişe, alış iptali girişten düşer", () => {
    const f = classifyStockFlows(
      [
        mv({ quantity: 10, description: "Açılış stoğu" }),
        mv({ quantity: 20, reference: "alis" }),
        mv({ quantity: -20, reference: "alis" }),
        mv({ quantity: 4, reference: "waybill:1" }),
      ],
      familyOf,
    ).get("p")!
    expect(f.inbound).toBe(14)
  })

  it("belgeye bağlı ikram/sayım (ADJUSTMENT) satış sayılmaz", () => {
    const f = classifyStockFlows(
      [mv({ type: "ADJUSTMENT", quantity: -1, reference: "fis", description: "İkram: Latte" })],
      familyOf,
    ).get("p")!
    expect(f.sold).toBe(0)
    expect(f.other).toBe(-1)
  })

  it("reçete bileşeni ve onun iptal iadesi reçete sütununda kalır", () => {
    const f = classifyStockFlows(
      [
        mv({ productId: "sut", quantity: -0.2, reference: "fis", description: "FS-1 - Reçete: Latte" }),
        mv({ productId: "sut", quantity: 0.2, reference: "fis", description: "FS-1 - Fatura iptali (stok iade)" }),
        mv({ productId: "sut", quantity: -0.3, reference: "fatura", description: "F-2 - Reçete: Latte" }),
      ],
      familyOf,
    ).get("sut")!
    expect(f.sold).toBe(0)
    expect(f.recipe).toBe(0.3)
  })

  it("transfer hiçbir sütuna girmez; silinmiş belgenin hareketi diğerdir", () => {
    const f = classifyStockFlows(
      [mv({ type: "TRANSFER", quantity: -5 }), mv({ type: "TRANSFER", quantity: 5 }), mv({ quantity: -2, reference: "silinmis" })],
      familyOf,
    ).get("p")!
    expect(f).toEqual({ inbound: 0, sold: 0, recipe: 0, other: -2 })
  })

  it("değişmez: giriş − satış − reçete + diğer = hareketlerin işaretli toplamı", () => {
    const movements = [
      mv({ quantity: 10 }),
      mv({ quantity: -3, reference: "fatura" }),
      mv({ quantity: 1, reference: "iade" }),
      mv({ quantity: -0.5, reference: "fis", description: "Reçete: X" }),
      mv({ quantity: -2, reason: "WASTE" }),
      mv({ type: "ADJUSTMENT", quantity: 1.25 }),
      mv({ quantity: -1, reason: "SALE" }),
    ]
    const f = classifyStockFlows(movements, familyOf).get("p")!
    const net = movements.reduce((s, m) => s + Number(m.quantity), 0)
    expect(f.inbound - f.sold - f.recipe + f.other).toBeCloseTo(net, 6)
  })
})

describe("applyDocumentSales", () => {
  it("belgeden sayılan üründe hareketten gelen satış EZİLİR (çift sayım yok)", () => {
    const flows = classifyStockFlows([mv({ productId: "latte", quantity: -2, reference: "fatura" })], familyOf)
    applyDocumentSales(flows, new Set(["latte", "hizmet"]), new Map([["latte", 7]]))
    expect(flows.get("latte")!.sold).toBe(7)
    expect(flows.get("hizmet")!.sold).toBe(0)
  })
})
