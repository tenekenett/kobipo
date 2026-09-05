import { describe, expect, it, vi } from "vitest"
import { isOutboundInvoice, prepareInvoiceStockOps, sameStockLines } from "./invoice-stock"

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

  it("yönü verilmemiş iade GİRİŞTİR — returnKind sütunundan önceki belgeler", async () => {
    // NULL returnKind'ı satış iadesi saymak, sütun eklenmeden önce kesilmiş
    // iadelerin davranışını birebir korur. Bu test o sözleşmenin nöbetçisidir.
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


describe("iade yönü — isOutboundInvoice", () => {
  it("satış çıkış, alış giriştir", () => {
    expect(isOutboundInvoice("SALES")).toBe(true)
    expect(isOutboundInvoice("PURCHASE")).toBe(false)
  })

  it("satış iadesi GİRİŞ, alış iadesi ÇIKIŞ", () => {
    expect(isOutboundInvoice("RETURN", "SALES")).toBe(false)
    expect(isOutboundInvoice("RETURN", "PURCHASE")).toBe(true)
  })

  it("yön yoksa/tanınmazsa satış iadesi sayılır (giriş)", () => {
    expect(isOutboundInvoice("RETURN", null)).toBe(false)
    expect(isOutboundInvoice("RETURN", "")).toBe(false)
    expect(isOutboundInvoice("RETURN", "SAÇMA")).toBe(false)
  })

  it("yön alanı yalnız iadede dinlenir — alışta yok sayılır", () => {
    // PURCHASE + returnKind:"PURCHASE" bir alış faturasıdır, alış İADESİ değil.
    // Yön alanı tipten bağımsız okunsaydı normal alış stoktan düşerdi.
    expect(isOutboundInvoice("PURCHASE", "PURCHASE")).toBe(false)
  })
})

describe("prepareInvoiceStockOps — satır iskontosu maliyete iner", () => {
  // Harekete yazılan fiyat AVCO'nun tek girdisidir (lib/stock/cost.ts). Liste
  // fiyatı yazıldığı sürece iskontolu alınan mal ortalamayı gerçekte ödenenin
  // ÜSTÜNE çekiyor, kullanıcı kârını olduğundan düşük görüyordu.
  it("iskonto düşülmüş NET birim fiyat yazılır", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "PURCHASE",
      // 10 × ₺25 = ₺250, ₺50 iskonto → net ₺200 → birim ₺20.
      lines: [{ productId: "p1", quantity: 10, unitPrice: 25, discountAmount: 50, order: 0 }],
    })

    expect(ops).toEqual([{ productId: "p1", delta: 10, unitPrice: 20, recipeNote: null }])
  })

  it("iskonto yoksa/0 ise liste fiyatı korunur — eski davranış birebir", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "PURCHASE",
      lines: [
        { productId: "p1", quantity: 4, unitPrice: 25, discountAmount: 0, order: 0 },
        { productId: "p2", quantity: 4, unitPrice: 30, discountAmount: null, order: 1 },
        { productId: "p3", quantity: 4, unitPrice: 40, order: 2 },
      ],
    })

    expect(ops.map((o) => o.unitPrice)).toEqual([25, 30, 40])
  })

  it("iskonto satır tutarını AŞARSA fiyat eksiye düşmez, liste fiyatında kalır", async () => {
    // Veri hatası: ₺100'lük satıra ₺500 iskonto. Negatif birim maliyet ortalamayı
    // sessizce bozardı — 0'a kırpmak da malı bedava gösterirdi.
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "PURCHASE",
      lines: [{ productId: "p1", quantity: 4, unitPrice: 25, discountAmount: 500, order: 0 }],
    })

    expect(ops[0].unitPrice).toBe(25)
  })

  it("fiyatsız kalemde iskonto bir şey uydurmaz — fiyat null kalır", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "PURCHASE",
      lines: [{ productId: "p1", quantity: 4, unitPrice: null, discountAmount: 10, order: 0 }],
    })

    expect(ops[0].unitPrice).toBeNull()
  })
})

describe("prepareInvoiceStockOps — iki yönlü iade", () => {
  it("alış iadesinde mal depodan ÇIKAR", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "RETURN",
      returnKind: "PURCHASE",
      lines: [line("p1", 4, 12, 0)],
    })

    expect(ops).toEqual([{ productId: "p1", delta: -4, unitPrice: 12, recipeNote: null }])
  })

  it("satış iadesinde mal depoya GİRER", async () => {
    const ops = await prepareInvoiceStockOps(fakeDb(), {
      companyId: "c1",
      type: "RETURN",
      returnKind: "SALES",
      lines: [line("p1", 4, 12, 0)],
    })

    expect(ops).toEqual([{ productId: "p1", delta: 4, unitPrice: 12, recipeNote: null }])
  })

  it("iadede hizmet kalemi iki yönde de elenir", async () => {
    for (const kind of ["SALES", "PURCHASE"]) {
      const ops = await prepareInvoiceStockOps(fakeDb(["hizmet"]), {
        companyId: "c1",
        type: "RETURN",
        returnKind: kind,
        lines: [line("hizmet", 1, 100, 0), line("p1", 2, 5, 1)],
      })
      expect(ops.map((o) => o.productId)).toEqual(["p1"])
    }
  })
})
