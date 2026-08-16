import { describe, expect, it, vi } from "vitest"
import { prepareInvoiceStockOps, sameStockLines } from "./invoice-stock"

// Alış/iade yolunda reçete genişletmesi ÇALIŞMAZ; tek DB dokunuşu hizmet ürünü
// filtresidir (product.findMany). Bu yüzden sahte db yeterli — gerçek Prisma'ya
// bağlanmadan alış faturasının stok etkisi doğrulanabiliyor.
function fakeDb(serviceProductIds: string[] = []) {
  return {
    product: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? []
        return ids.filter((id) => serviceProductIds.includes(id)).map((id) => ({ id }))
      }),
    },
    productRecipe: {
      findMany: vi.fn(async () => []),
    },
  } as any
}

const line = (productId: string | null, quantity: number, unitPrice: number, order: number) => ({
  productId,
  quantity,
  unitPrice,
  order,
})

describe("prepareInvoiceStockOps — alış faturası", () => {
  it("alışta miktar depoya GİRİŞ olarak (+) yazılır", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "PURCHASE",
      lines: [line("p1", 10, 25, 0), line("p2", 3, 100, 1)],
    })

    expect(ops).toEqual([
      { productId: "p1", delta: 10, unitPrice: 25, recipeNote: null },
      { productId: "p2", delta: 3, unitPrice: 100, recipeNote: null },
    ])
  })

  it("satışta aynı kalem ÇIKIŞ (−) olur — yön tipten türer", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "SALES",
      lines: [line("p1", 10, 25, 0)],
    })

    expect(ops).toEqual([{ productId: "p1", delta: -10, unitPrice: 25, recipeNote: null }])
  })

  it("iade de giriştir (alışla aynı yön)", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "RETURN",
      lines: [line("p1", 2, 5, 0)],
    })

    expect(ops[0].delta).toBe(2)
  })

  it("ürüne bağlanmamış (serbest metin) kalem stok üretmez", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "PURCHASE",
      lines: [line(null, 10, 25, 0), line("p1", 1, 1, 1)],
    })

    expect(ops).toHaveLength(1)
    expect(ops[0].productId).toBe("p1")
  })

  it("miktarı 0 olan kalem atlanır", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "PURCHASE",
      lines: [line("p1", 0, 25, 0)],
    })

    expect(ops).toEqual([])
  })

  it("hizmet ürünü stok takibi yapmaz → elenir", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(["p2"]), {
      companyId: "c1",
      type: "PURCHASE",
      lines: [line("p1", 4, 10, 0), line("p2", 1, 500, 1)],
    })

    expect(ops.map((o) => o.productId)).toEqual(["p1"])
  })

  it("geçersiz tip hiçbir hareket üretmez", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "SOMETHING",
      lines: [line("p1", 4, 10, 0)],
    })

    expect(ops).toEqual([])
  })
})

describe("sameStockLines", () => {
  const prev = [
    { productId: "p1", quantity: 10, unitPrice: 25 },
    { productId: "p2", quantity: 3, unitPrice: 100 },
  ]

  it("aynı kalemler — sıra değişse bile stok etkisi aynıdır", () => {
    expect(
      sameStockLines(prev, [
        { productId: "p2", quantity: 3, unitPrice: 100 },
        { productId: "p1", quantity: 10, unitPrice: 25 },
      ]),
    ).toBe(true)
  })

  it("miktar değişince mutabakat gerekir", () => {
    expect(
      sameStockLines(prev, [
        { productId: "p1", quantity: 5, unitPrice: 25 },
        { productId: "p2", quantity: 3, unitPrice: 100 },
      ]),
    ).toBe(false)
  })

  it("birim fiyat değişimi de sayılır — AVCO maliyetine girer", () => {
    expect(
      sameStockLines(prev, [
        { productId: "p1", quantity: 10, unitPrice: 30 },
        { productId: "p2", quantity: 3, unitPrice: 100 },
      ]),
    ).toBe(false)
  })

  it("ürün değişimi yakalanır", () => {
    expect(
      sameStockLines(prev, [
        { productId: "p9", quantity: 10, unitPrice: 25 },
        { productId: "p2", quantity: 3, unitPrice: 100 },
      ]),
    ).toBe(false)
  })

  it("kalem silinince/eklenince farklıdır", () => {
    expect(sameStockLines(prev, [{ productId: "p1", quantity: 10, unitPrice: 25 }])).toBe(false)
  })

  it("Prisma Decimal (toString taşıyan nesne) ile sayı kıyaslanabilir", () => {
    const decimalish = [
      { productId: "p1", quantity: { toString: () => "10" }, unitPrice: { toString: () => "25" } },
    ]
    expect(sameStockLines(decimalish, [{ productId: "p1", quantity: 10, unitPrice: 25 }])).toBe(true)
  })

  it("ürünsüz (serbest metin) kalemlerin metin değişimi stoğu ilgilendirmez", () => {
    expect(
      sameStockLines(
        [{ productId: null, quantity: 1, unitPrice: 500 }],
        [{ productId: null, quantity: 1, unitPrice: 500 }],
      ),
    ).toBe(true)
  })
})
