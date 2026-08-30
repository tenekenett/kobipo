// `setOpeningStock`un ÜÇ TABLOYU birlikte tutan kısmı.
//
// `planOpeningStock` aritmetiği ayrıca sınanıyor (opening-stock.test.ts); buradaki
// soru farklı: hareket, depo satırı ve kart AYNI anda doğru değişiyor mu? Bu
// modülün tek değişmezi Σ(WarehouseStock) = Product.stockQuantity ve açılış
// düzeltmesi onu bozmaya en yatkın yol — çünkü hareketin miktarı (HEDEF) ile
// bakiyeye işlenen sayı (FARK) kasten birbirinden farklı.
//
// Sahte bir Prisma istemcisiyle çalışır: gerçek veritabanı gerekmez, dolayısıyla
// vitest'in "lib/** + saf mantık" kapsamından çıkmaz.

import { describe, expect, it } from "vitest"
import { setOpeningStock, getOpeningStock, OPENING_STOCK_DESCRIPTION } from "./warehouse"

type Movement = {
  id: string
  companyId: string
  productId: string
  warehouseId: string | null
  type: string
  quantity: number
  unitPrice: number | null
  description: string | null
  reference: string | null
  createdAt: Date
  createdBy?: string | null
  employeeId?: string | null
}

function makeDb(seed: {
  product: { id: string; companyId: string; stockQuantity: number; isService?: boolean }
  warehouses?: { id: string; companyId: string; isDefault?: boolean }[]
  stocks?: { warehouseId: string; productId: string; quantity: number }[]
  movements?: Partial<Movement>[]
}) {
  const product = { isService: false, ...seed.product }
  const warehouses = seed.warehouses ?? [{ id: "wh1", companyId: product.companyId, isDefault: true }]
  const stocks = (seed.stocks ?? []).map((s) => ({ ...s }))
  const movements: Movement[] = (seed.movements ?? []).map((m, i) => ({
    id: m.id ?? `mv${i}`,
    companyId: m.companyId ?? product.companyId,
    productId: m.productId ?? product.id,
    warehouseId: m.warehouseId ?? "wh1",
    type: m.type ?? "IN",
    quantity: m.quantity ?? 0,
    unitPrice: m.unitPrice ?? null,
    description: m.description ?? null,
    reference: m.reference ?? null,
    createdAt: m.createdAt ?? new Date(2026, 0, 1),
  }))

  const findStock = (warehouseId: string, productId: string) =>
    stocks.find((s) => s.warehouseId === warehouseId && s.productId === productId)

  const db = {
    product: {
      findUnique: async () => ({ ...product }),
      update: async ({ data }: any) => {
        if (data.stockQuantity?.increment != null) product.stockQuantity += data.stockQuantity.increment
        return { ...product }
      },
    },
    warehouse: {
      findFirst: async ({ where }: any) =>
        warehouses.find(
          (w) =>
            w.companyId === where.companyId && (where.isDefault ? w.isDefault : true),
        ) ?? null,
      create: async ({ data }: any) => {
        const created = { id: `wh${warehouses.length + 1}`, ...data }
        warehouses.push(created)
        return created
      },
    },
    warehouseStock: {
      findMany: async () => stocks.map((s) => ({ ...s, id: `${s.warehouseId}:${s.productId}` })),
      findUnique: async ({ where }: any) => {
        const key = where.warehouseId_productId
        const row = findStock(key.warehouseId, key.productId)
        return row ? { ...row } : null
      },
      update: async ({ where, data }: any) => {
        const key = where.warehouseId_productId
        const row = findStock(key.warehouseId, key.productId)!
        if (data.quantity?.decrement != null) row.quantity -= data.quantity.decrement
        if (data.quantity?.increment != null) row.quantity += data.quantity.increment
        return { ...row }
      },
      upsert: async ({ where, create, update }: any) => {
        const key = where.warehouseId_productId
        const row = findStock(key.warehouseId, key.productId)
        if (!row) {
          stocks.push({ ...create })
          return create
        }
        if (update.quantity?.increment != null) row.quantity += update.quantity.increment
        if (update.quantity?.decrement != null) row.quantity -= update.quantity.decrement
        return { ...row }
      },
    },
    stockMovement: {
      findFirst: async ({ where }: any) =>
        movements.find(
          (m) =>
            m.companyId === where.companyId &&
            m.productId === where.productId &&
            m.type === where.type &&
            m.description === where.description &&
            m.reference === where.reference,
        ) ?? null,
      aggregate: async ({ where }: any) => ({
        _sum: {
          quantity: movements
            .filter((m) => m.companyId === where.companyId && m.productId === where.productId)
            .reduce((sum, m) => sum + m.quantity, 0),
        },
      }),
      create: async ({ data }: any) => {
        const created: Movement = {
          id: `mv${movements.length}`,
          unitPrice: null,
          description: null,
          reference: null,
          createdAt: new Date(),
          ...data,
        }
        movements.push(created)
        return created
      },
      update: async ({ where, data }: any) => {
        const row = movements.find((m) => m.id === where.id)!
        Object.assign(row, data)
        return { ...row }
      },
    },
  }

  return { db: db as any, product, stocks, movements }
}

/** Değişmez: Σ(depo satırları) = kart bakiyesi. */
const expectBalanced = (state: ReturnType<typeof makeDb>) => {
  const sum = state.stocks.reduce((a, s) => a + s.quantity, 0)
  expect(Math.round(sum * 10000) / 10000).toBe(Math.round(state.product.stockQuantity * 10000) / 10000)
}

describe("setOpeningStock", () => {
  it("açılışı yükseltir: hareket HEDEFİ, kart ve depo FARKI alır", async () => {
    // Açılış 100 girilmiş, 30'u satılmış → kart 70.
    const state = makeDb({
      product: { id: "p1", companyId: "c1", stockQuantity: 70 },
      stocks: [{ warehouseId: "wh1", productId: "p1", quantity: 70 }],
      movements: [
        { id: "opening", quantity: 100, description: OPENING_STOCK_DESCRIPTION },
        { id: "sale", quantity: -30, type: "OUT", description: "Satış" },
      ],
    })

    const result = await setOpeningStock(state.db, {
      companyId: "c1",
      productId: "p1",
      quantity: 120,
    })

    expect(result).toMatchObject({ ok: true, openingQuantity: 120, delta: 20, stockQuantity: 90 })
    expect(state.movements.find((m) => m.id === "opening")!.quantity).toBe(120)
    expect(state.movements).toHaveLength(2) // yeni hareket YAZILMAZ
    expect(state.stocks[0].quantity).toBe(90)
    expectBalanced(state)
  })

  it("hareketi olmayan ESKİ üründe açılışı hareketle temsil eder, kartı ŞİŞİRMEZ", async () => {
    // Tek kapı öncesi kayıt: kart 100 ama defterde satır yok.
    const state = makeDb({
      product: { id: "p1", companyId: "c1", stockQuantity: 100 },
      stocks: [{ warehouseId: "wh1", productId: "p1", quantity: 100 }],
      movements: [],
    })

    const result = await setOpeningStock(state.db, {
      companyId: "c1",
      productId: "p1",
      quantity: 100,
    })

    expect(result).toMatchObject({ ok: true, delta: 0, stockQuantity: 100 })
    expect(state.product.stockQuantity).toBe(100) // 200 OLMAZ
    expect(state.movements).toHaveLength(1)
    expect(state.movements[0]).toMatchObject({
      quantity: 100,
      description: OPENING_STOCK_DESCRIPTION,
      type: "IN",
    })
    expectBalanced(state)
  })

  it("güncel bakiyeyi negatife düşürecek azaltmayı reddeder ve hiçbir şeye dokunmaz", async () => {
    const state = makeDb({
      product: { id: "p1", companyId: "c1", stockQuantity: 10 },
      stocks: [{ warehouseId: "wh1", productId: "p1", quantity: 10 }],
      movements: [
        { id: "opening", quantity: 100, description: OPENING_STOCK_DESCRIPTION },
        { id: "sale", quantity: -90, type: "OUT", description: "Satış" },
      ],
    })

    const result = await setOpeningStock(state.db, {
      companyId: "c1",
      productId: "p1",
      quantity: 5,
    })

    expect(result.ok).toBe(false)
    expect(state.product.stockQuantity).toBe(10)
    expect(state.movements.find((m) => m.id === "opening")!.quantity).toBe(100)
    expectBalanced(state)
  })

  it("hizmet kaleminde çalışmaz", async () => {
    const state = makeDb({
      product: { id: "p1", companyId: "c1", stockQuantity: 0, isService: true },
    })
    const result = await setOpeningStock(state.db, {
      companyId: "c1",
      productId: "p1",
      quantity: 5,
    })
    expect(result).toEqual({ ok: false, error: "Hizmet kaleminde stok hareketi olmaz" })
  })

  it("açılışı 0'a çeker: kart düşer, sıfır miktarlı hareket YAZILMAZ", async () => {
    const state = makeDb({
      product: { id: "p1", companyId: "c1", stockQuantity: 40 },
      stocks: [{ warehouseId: "wh1", productId: "p1", quantity: 40 }],
      movements: [],
    })

    const result = await setOpeningStock(state.db, {
      companyId: "c1",
      productId: "p1",
      quantity: 0,
    })

    expect(result).toMatchObject({ ok: true, delta: -40, stockQuantity: 0 })
    expect(state.movements).toHaveLength(0)
    expectBalanced(state)
  })
})

describe("getOpeningStock", () => {
  it("hareket varsa onu, yoksa kalıntıyı döndürür", async () => {
    const tracked = makeDb({
      product: { id: "p1", companyId: "c1", stockQuantity: 70 },
      movements: [
        { id: "opening", quantity: 100, description: OPENING_STOCK_DESCRIPTION },
        { id: "sale", quantity: -30, type: "OUT" },
      ],
    })
    expect(await getOpeningStock(tracked.db, "c1", "p1")).toMatchObject({
      quantity: 100,
      tracked: true,
    })

    const legacy = makeDb({
      product: { id: "p1", companyId: "c1", stockQuantity: 60 },
      movements: [{ id: "sale", quantity: -40, type: "OUT" }],
    })
    expect(await getOpeningStock(legacy.db, "c1", "p1")).toMatchObject({
      quantity: 100, // 60 − (−40)
      tracked: false,
    })
  })
})
